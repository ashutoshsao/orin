import type { AgentEvent, AgentSession } from "./agent/agent";

// One live AgentSession per project, owned by the server — not by any one connection.
//
// It used to be one session per SSE connection: the stream's `finally` killed the
// sandbox. So any dropped connection (a network blip, a sleeping laptop) killed a build
// mid-change — twice in one day, each leaving a half-finished edit behind. Now a stream is
// just a *subscriber*: it attaches, detaches, and can come back. The session keeps
// running while nobody is watching, and is only closed after GRACE_MS with no subscribers.
//
// Every broadcast event gets an increasing `id` (sent as the SSE `id:` field) and is
// kept in a bounded buffer, so a reconnecting page can say "I saw up to id N" and get
// exactly what it missed — the textbook SSE resume pattern.

// How long a session outlives its last viewer. Overridable so tests needn't wait a minute.
const GRACE_MS = Number(process.env.ORIN_GRACE_MS ?? 60_000);
const BUFFER_MAX = 2_000;
const RUN_ENDS = new Set(["final", "error", "exception", "max_iterations_reached"]);

export type StreamEvent = AgentEvent & { id?: number };
type Subscriber = { push: (e: StreamEvent) => void };

type Live = {
  projectId: string;
  session: AgentSession | null; // null while the sandbox boots
  subscribers: Set<Subscriber>;
  buffer: StreamEvent[];
  nextId: number;
  grace: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  // Current state, so a page attaching fresh (no resume id) can be brought up to date
  // without replaying — and duplicating — history it already loads from the database.
  lastPreview?: StreamEvent;
  pendingAsk?: StreamEvent;
  runActive: boolean;
  step?: number;
};

const lives = new Map<string, Live>(); // by projectId
const byId = new Map<string, AgentSession>(); // by sessionId, for follow-up/answer POSTs

export const getLive = (projectId: string) => lives.get(projectId);
export const getSession = (sessionId: string) => byId.get(sessionId);

function broadcast(live: Live, e: AgentEvent) {
  const ev: StreamEvent = { ...e, id: live.nextId++ };
  live.buffer.push(ev);
  if (live.buffer.length > BUFFER_MAX) live.buffer.shift();

  if (ev.event === "preview_ready") live.lastPreview = ev;
  else if (ev.event === "ask_user") live.pendingAsk = ev;
  else if (ev.event === "run_start") { live.runActive = true; live.step = undefined; live.pendingAsk = undefined; }
  else if (ev.event === "llm_call" && typeof ev.iteration === "number") live.step = ev.iteration;
  else if (ev.event === "tool_call") live.pendingAsk = undefined; // an answered question's round
  if (RUN_ENDS.has(ev.event)) { live.runActive = false; live.pendingAsk = undefined; }

  for (const sub of live.subscribers) sub.push(ev);
}

// Register a live session for a project and boot it. Registration is synchronous, so
// two connections racing for the same project attach to one session instead of two.
// `boot` creates the AgentSession (wired to broadcast) and may return follow-up work
// (start the preview, run the first prompt) that continues in the background.
export function startLive(
  projectId: string,
  boot: (onEvent: (e: AgentEvent) => void) => Promise<{ session: AgentSession; afterReady: () => Promise<void> }>,
): Live {
  const live: Live = {
    projectId, session: null, subscribers: new Set(), buffer: [], nextId: 1,
    grace: null, closed: false, runActive: false,
  };
  lives.set(projectId, live);
  void (async () => {
    try {
      const { session, afterReady } = await boot((e) => broadcast(live, e));
      if (live.closed) { await session.close().catch(() => {}); return; } // closed while booting
      live.session = session;
      byId.set(session.id, session);
      await afterReady();
    } catch (e) {
      broadcast(live, { ts: new Date().toISOString(), sessionId: "", event: "stream_error", message: String(e) });
      await closeLive(projectId);
    }
  })();
  return live;
}

// Attach a stream. Returns what it should be sent before live events:
//  - `after` given and still in the buffer → exactly the events it missed (resume);
//  - otherwise → a small state snapshot (preview, running step, open question), since
//    a fresh page loads the conversation itself from the database.
export function subscribe(live: Live, sub: Subscriber, after?: number): { replay: StreamEvent[]; resumed: boolean } {
  if (live.grace) { clearTimeout(live.grace); live.grace = null; }
  live.subscribers.add(sub);
  const oldest = live.buffer[0]?.id ?? live.nextId;
  if (after !== undefined && after + 1 >= oldest) {
    return { replay: live.buffer.filter((e) => (e.id ?? 0) > after), resumed: true };
  }
  const sessionId = live.session?.id ?? "";
  const replay: StreamEvent[] = [];
  if (live.lastPreview) replay.push(live.lastPreview);
  if (live.runActive) replay.push({ ts: new Date().toISOString(), sessionId, event: "run_active", step: live.step });
  if (live.pendingAsk) replay.push(live.pendingAsk);
  return { replay, resumed: live.session !== null || live.buffer.length > 0 };
}

// Detach a stream. The last one to leave starts the grace timer; if nobody comes back
// in time, the session (and its sandbox) is closed.
export function unsubscribe(live: Live, sub: Subscriber) {
  live.subscribers.delete(sub);
  if (live.subscribers.size === 0 && !live.closed && !live.grace) {
    live.grace = setTimeout(() => void closeLive(live.projectId), GRACE_MS);
  }
}

// Close a project's live session now (grace expired, or a rewind needs a fresh one).
export async function closeLive(projectId: string) {
  const live = lives.get(projectId);
  if (!live || live.closed) return;
  live.closed = true;
  if (live.grace) clearTimeout(live.grace);
  lives.delete(projectId);
  if (live.session) {
    byId.delete(live.session.id);
    // close() flushes any parked ask_user promise, so a turn blocked on an answer unwinds.
    await live.session.close().catch(() => {});
  }
}
