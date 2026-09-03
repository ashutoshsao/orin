import { Elysia, sse, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { and, asc, desc, eq, gt, gte } from "drizzle-orm";
import { db, message, project, snapshot } from "@repo/db";
import { DeepSeekProvider } from "./agent/LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession } from "./agent/agent";
import { closeLive, getLive, getSession, startLive, subscribe, unsubscribe, type StreamEvent } from "./liveSessions";
import { loadContext, messagePersister, snapshotLoader } from "./persistence/store";
import { snapshotEnqueuer, startSnapshotWorker } from "./persistence/snapshotQueue";
import { sweepOrphanSandboxes } from "./sandbox/sweep";
import { auth } from "./auth";

const PORT = 4000;
const WEB_ORIGIN = "http://localhost:5173";

// Resolve the signed-in user from the request's cookies (Better Auth session).
async function getUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}

// Live sessions (one per project, outliving individual streams) live in liveSessions.ts.

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
  // credentials + explicit origin so the browser sends/accepts auth cookies cross-origin
  .use(cors({ origin: WEB_ORIGIN, credentials: true }))
  // Better Auth routes (sign-up/in/out, session) mount at /api/auth/*
  .mount(auth.handler)
  // Create a project (owned by the signed-in user).
  .post(
    "/projects",
    async ({ request, body, set }) => {
      const userId = await getUserId(request);
      if (!userId) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const [row] = await db.insert(project).values({ userId, name: body.name }).returning();
      return row;
    },
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  )
  // List the signed-in user's projects, newest first.
  .get("/projects", async ({ request, set }) => {
    const userId = await getUserId(request);
    if (!userId) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return db.select().from(project).where(eq(project.userId, userId)).orderBy(desc(project.updatedAt));
  })
  // Persisted conversation for a project, ordered — lets the UI replay the transcript on
  // reopen (agent memory is already restored server-side; this is the visual history).
  .get(
    "/projects/:id/messages",
    async ({ params, request, set }) => {
      const userId = await getUserId(request);
      if (!userId) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, params.id), eq(project.userId, userId)))
        .limit(1);
      if (!proj) {
        set.status = 404;
        return { error: "project_not_found" };
      }
      return db
        // createdAt lets the replayed transcript show the same timestamps as the live one.
        .select({ seq: message.seq, role: message.role, content: message.content, createdAt: message.createdAt })
        .from(message)
        .where(eq(message.projectId, params.id))
        .orderBy(asc(message.seq));
    },
  )
  // Rewind points for a project — each pushed snapshot, oldest first.
  .get(
    "/projects/:id/snapshots",
    async ({ params, request, set }) => {
      const userId = await getUserId(request);
      if (!userId) { set.status = 401; return { error: "unauthorized" }; }
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, params.id), eq(project.userId, userId)))
        .limit(1);
      if (!proj) { set.status = 404; return { error: "project_not_found" }; }
      return db
        .select({ id: snapshot.id, commitHash: snapshot.commitHash, n: snapshot.n, createdAt: snapshot.createdAt })
        .from(snapshot)
        .where(eq(snapshot.projectId, params.id))
        .orderBy(asc(snapshot.n));
    },
  )
  // Rewind a project to a chosen snapshot: point it at that snapshot's bundle, discard
  // the conversation and snapshots past it (the abandoned branch), so the next reopen
  // restores that codebase + the clamped context. The client reopens afterwards.
  .post(
    "/projects/:id/rewind",
    async ({ params, body, request, set }) => {
      const userId = await getUserId(request);
      if (!userId) { set.status = 401; return { error: "unauthorized" }; }
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, params.id), eq(project.userId, userId)))
        .limit(1);
      if (!proj) { set.status = 404; return { error: "project_not_found" }; }
      const [snap] = await db
        .select()
        .from(snapshot)
        .where(and(eq(snapshot.id, body.snapshotId), eq(snapshot.projectId, params.id)))
        .limit(1);
      if (!snap) { set.status = 404; return { error: "snapshot_not_found" }; }

      // Sessions now outlive their stream, so a live one would still hold the pre-rewind
      // code and history — close it first; the page's reopen then starts a fresh one.
      await closeLive(params.id);
      await db
        .update(project)
        .set({ latestSnapshotKey: snap.key, durableCodebaseN: snap.n, updatedAt: new Date() })
        .where(eq(project.id, params.id));
      await db.delete(message).where(and(eq(message.projectId, params.id), gte(message.seq, snap.n)));
      await db.delete(snapshot).where(and(eq(snapshot.projectId, params.id), gt(snapshot.n, snap.n)));
      return { ok: true, n: snap.n };
    },
    { body: t.Object({ snapshotId: t.String() }) },
  )
  .get(
    "/agent/stream",
    async function* ({ query, request }) {
      // Auth + ownership before streaming (EventSource can't send headers, so this
      // rides on the session cookie). On failure, emit one event and end the stream.
      const userId = await getUserId(request);
      if (!userId) {
        yield sse({ data: { event: "unauthorized" } });
        return;
      }
      const [proj] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, query.projectId), eq(project.userId, userId)))
        .limit(1);
      if (!proj) {
        yield sse({ data: { event: "project_not_found" } });
        return;
      }
      // Attach to the project's live session, or start one. The session is owned by the
      // server (liveSessions.ts); this stream is only a subscriber to it.
      const projectId = query.projectId;
      const live = getLive(projectId) ?? startLive(projectId, async (onEvent) => {
        // Resume: load any prior conversation to seed the session (empty for a new project).
        const initialContext = await loadContext(projectId);
        const provider = new DeepSeekProvider("deepseek-v4.1-flash-expires-on-0910", "low");
        const session = await AgentSession.create(provider, {
          onEvent,
          persist: messagePersister(projectId),
          enqueueSnapshot: snapshotEnqueuer(projectId, userId),
          restoreSnapshot: snapshotLoader(projectId),
          initialContext,
        });
        return {
          session,
          afterReady: async () => {
            // Start the dev server in parallel with the first build so the preview is
            // live *while* the agent edits (Vite HMR shows progress), not only after.
            const preview = session.startPreview(); // broadcasts preview_ready
            // `prompt` is only the *first* build of a brand-new project — never re-run for
            // a project that already has a conversation (a reconnect may carry it again).
            if (query.prompt && initialContext.length === 0) await session.submit(query.prompt);
            await preview.catch(() => { }); // settle/surface any preview startup error
          },
        };
      });

      const queue = createEventQueue<StreamEvent>();
      const sub = { push: (e: StreamEvent) => queue.push(e) };
      const after = query.after !== undefined ? Number(query.after) : undefined;
      const { replay, resumed } = subscribe(live, sub, Number.isFinite(after) ? after : undefined);

      // Heartbeat so idle proxies don't drop the connection after preview_ready.
      const heartbeat = setInterval(
        () => queue.push({ ts: new Date().toISOString(), sessionId: "", event: "ping" }),
        15_000,
      );

      let closeReason = "client_gone";
      try {
        // First, tell the page whether it rejoined a running session (keep its state) or
        // got a new one (the old one expired — reset). Then what it missed, then live.
        yield sse({ data: { ts: new Date().toISOString(), sessionId: live.session?.id ?? "", event: "attached", resumed } });
        for (const e of replay) yield sse({ id: e.id, data: e });
        for await (const event of queue.drain()) {
          // Default (unnamed) SSE messages so the browser's single `onmessage` catches all
          // of them — the type lives in the payload. `id` enables resume on reconnect.
          yield sse(event.id !== undefined ? { id: event.id, data: event } : { data: event });
        }
      } catch (e) {
        closeReason = `error: ${String(e)}`;
        throw e;
      } finally {
        // The page went away (or the stream failed). Detach only — the session keeps
        // running, and is closed after a grace period if nobody reattaches.
        clearInterval(heartbeat);
        queue.finish();
        unsubscribe(live, sub);
        // Diagnostic: dropped streams have killed builds before and the cause is still
        // unknown, so every close says why and how many viewers remain.
        console.log(JSON.stringify({ ts: new Date().toISOString(), event: "stream_closed", projectId, reason: closeReason, remaining: live.subscribers.size }));
      }
    },
    {
      query: t.Object({
        projectId: t.String(),
        prompt: t.Optional(t.String({ minLength: 1 })),
        // Last event id the page saw — resume from just after it.
        after: t.Optional(t.String()),
      }),
    },
  )
  // Follow-up prompt for an existing session. Fire-and-forget: submit() queues it
  // (applied at the next turn boundary) and its events flow down that session's
  // already-open SSE stream — so nothing is returned here but an ack.
  .post(
    "/agent/:sessionId/message",
    ({ params, body, set }) => {
      const session = getSession(params.sessionId);
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
  // Answer to an ask_user question. Resolves the parked tool call → the loop
  // resumes with the answer as the tool result → progress flows down the SSE stream.
  .post(
    "/agent/:sessionId/answer",
    ({ params, body, set }) => {
      const session = getSession(params.sessionId);
      if (!session) {
        set.status = 404;
        return { error: "session not found" };
      }
      const ok = session.answer(body.callId, body.answer);
      if (!ok) {
        set.status = 409;
        return { error: "no pending question for that callId" };
      }
      return { ok: true };
    },
    {
      body: t.Object({ callId: t.String(), answer: t.String() }),
    },
  )
  .listen(PORT);

// Drain codebase-snapshot jobs to R2 in the background, off the agent's hot path (M5b).
startSnapshotWorker();
// Kill sandboxes a crashed predecessor left running (fire-and-forget; never blocks boot).
void sweepOrphanSandboxes();

console.log(`agent SSE server → http://localhost:${PORT}/agent/stream?prompt=...`);
