import { Elysia, sse, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { DeepSeekProvider } from "./agent/LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession, type AgentEvent } from "./agent/agent";

const PORT = 4000;

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
  .use(cors()) // dev: web (5173) → api (4000) are different origins
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
          await session.run(query.prompt);
          await session.startPreview(); // pushes preview_ready (with the URL)
        } catch (e) {
          queue.push({ ts: new Date().toISOString(), sessionId: "", event: "stream_error", message: String(e) });
        }
        // Deliberately no finish() — keep the stream open so the sandbox stays
        // alive for the iframe. Heartbeats hold the connection until disconnect.
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
        await runner.catch(() => {});
        await session?.close().catch(() => {});
      }
    },
    {
      query: t.Object({ prompt: t.String({ minLength: 1 }) }),
    },
  )
  .listen(PORT);

console.log(`agent SSE server → http://localhost:${PORT}/agent/stream?prompt=...`);
