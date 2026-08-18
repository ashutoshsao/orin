import { Elysia, sse, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { and, desc, eq } from "drizzle-orm";
import { db, project } from "@repo/db";
import { DeepSeekProvider } from "./agent/LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession, type AgentEvent } from "./agent/agent";
import { loadContext, messagePersister } from "./persistence/store";
import { auth } from "./auth";

const PORT = 4000;
const WEB_ORIGIN = "http://localhost:5173";

// Resolve the signed-in user from the request's cookies (Better Auth session).
async function getUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}

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
      // Resume: load any prior conversation to seed the session (empty for a new project).
      const initialContext = await loadContext(query.projectId);

      const queue = createEventQueue<AgentEvent>();
      let session: AgentSession | undefined;

      // Run the agent in the background; its events flow into the queue.
      const runner = (async () => {
        try {
          const provider = new DeepSeekProvider("deepseek-v4.1-flash-expires-on-0910", "low");
          session = await AgentSession.create(provider, {
            onEvent: (e) => queue.push(e),
            persist: messagePersister(query.projectId),
            initialContext,
          });
          sessions.set(session.id, session); // now discoverable by follow-up POSTs
          // Start the dev server in parallel with the first build so the preview is
          // live *while* the agent edits (Vite HMR shows progress), not only after.
          const preview = session.startPreview(); // pushes preview_ready (with the URL)
          // prompt present = a new project's first build; absent = reopening (resume).
          if (query.prompt) await session.submit(query.prompt);
          await preview.catch(() => { }); // settle/surface any preview startup error
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
        if (session) sessions.delete(session.id);
        // close() BEFORE awaiting runner: it flushes any parked ask_user promise,
        // so a turn blocked waiting for an answer unwinds instead of deadlocking.
        await session?.close().catch(() => { });
        await runner.catch(() => { });
      }
    },
    {
      query: t.Object({
        projectId: t.String(),
        prompt: t.Optional(t.String({ minLength: 1 })),
      }),
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
  // Answer to an ask_user question. Resolves the parked tool call → the loop
  // resumes with the answer as the tool result → progress flows down the SSE stream.
  .post(
    "/agent/:sessionId/answer",
    ({ params, body, set }) => {
      const session = sessions.get(params.sessionId);
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

console.log(`agent SSE server → http://localhost:${PORT}/agent/stream?prompt=...`);
