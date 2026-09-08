import { Elysia, sse, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { DeepSeekProvider } from "./agent/LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession, type AgentEvent } from "./agent/agent";

const PORT = 4000;

// Live sessions, keyed by id, so follow-up POSTs can find the right session.
// A session is registered when its stream opens and removed on disconnect.
const sessions = new Map<string, AgentSession>();

// Bridge push→pull: AgentSession pushes events via its onEvent callback, but an
// Elysia SSE handler pulls by `yield`ing. This queue buffers pushes and lets the
// generator await the next one. `finish()` ends the async iteration.
function createEventQueue<T>() {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(item: T) {
      buffer.push(item);
      wake?.();
      wake = null;
    },
    finish() {
      done = true;
      wake?.();
      wake = null;
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        if (buffer.length) {
          yield buffer.shift()!;
          continue;
        }
        if (done) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

export const app = new Elysia()
  .use(cors())
  .get(
    "/agent/stream",
    async function* ({ query }) {
      const queue = createEventQueue<AgentEvent>();
      let session: AgentSession | undefined;

      // Run the agent in the background; its events flow into the queue.
      const runner = (async () => {
        try {
          const provider = new DeepSeekProvider("deepseek-v4-flash", "low");
          session = await AgentSession.create(provider, (e) => queue.push(e));
          sessions.set(session.id, session); // now discoverable by follow-up POSTs
          await session.submit(query.prompt); // first turn
          await session.startPreview(); // pushes preview_ready (with the URL)
        } catch (e) {
          queue.push({ ts: new Date().toISOString(), sessionId: "", event: "stream_error", message: String(e) });
        }
        // Deliberately no finish() — keep the stream open so the sandbox stays
        // alive for the iframe and for follow-ups. Heartbeats hold the connection.
      })();

      // Heartbeat so idle proxies don't drop the connection after preview_ready.
      const heartbeat = setInterval(
        () => queue.push({ ts: new Date().toISOString(), sessionId: "", event: "ping" }),
        15_000,
      );

      try {
        for await (const event of queue.drain()) {
          // Send as default (unnamed) SSE messages so the browser's single
          // `EventSource.onmessage` catches them all — the event type already
          // lives inside the payload (`data.event`). Named SSE events would
          // require a per-type addEventListener on the client.
          yield sse({ data: event });
        }
      } finally {
        // Client disconnected → Elysia stops this generator and runs finally.
        // Tear the sandbox down (this is what ties its lifetime to the connection).
        clearInterval(heartbeat);
        queue.finish();
        await runner.catch(() => { });
        if (session) sessions.delete(session.id);
        await session?.close().catch(() => { });
      }
    },
    {
      query: t.Object({ prompt: t.String({ minLength: 1 }) }),
    },
  )
  // Follow-up prompt for an existing session. Fire-and-forget: submit() queues it
  // (applied at the next turn boundary) and its events flow down that session's
  // already-open SSE stream — so nothing is returned here but an ack.
  .post(
    "/agent/:sessionId/message",
    ({ params, body, set }) => {
      const session = sessions.get(params.sessionId);
      if (!session) {
        set.status = 404;
        return { error: "session not found" };
      }
      session.submit(body.prompt); // not awaited — events surface on the SSE stream
      return { ok: true };
    },
    {
      body: t.Object({ prompt: t.String({ minLength: 1 }) }),
    },
  )
  .listen(PORT);

console.log(`agent SSE server → http://localhost:${PORT}/agent/stream?prompt=...`);
