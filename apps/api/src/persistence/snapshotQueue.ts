import { RedisClient } from "bun";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, project } from "@repo/db";
import { r2, snapshotKey } from "./r2";
import type { SnapshotJob } from "../agent/agent";

// Non-blocking snapshot push (M5b). The agent loop enqueues a job and moves on; a
// background worker drains the stream FIFO and does the slow R2 upload off the hot path.
// Redis carries only small metadata — the bundle BYTES stay in-process (`bundles`), so
// the stream never holds MB-sized payloads. The queue is ephemeral: recovery truth is
// R2 + Postgres, so we don't need AOF; a lost in-flight job is just re-done (the clamp
// discards its round). Single shared stream + single consumer here (per-project order is
// preserved as a subset); sharding by projectId comes with multi-worker scale.

const STREAM = "orin:snapshots";
const URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const producer = new RedisClient(URL);
// Bundle bytes indexed by job id — kept out of Redis, handed to the worker in-process.
const bundles = new Map<string, Uint8Array>();
// Last commit durably in R2 per project — a `mark` (no-op round) only advances the
// durable marker when HEAD is this, so it never claims a committed-but-unpushed round.
const lastPushed = new Map<string, string>();

// Producer bound to one project/user, injected into AgentSession as `enqueueSnapshot`.
export function snapshotEnqueuer(projectId: string, userId: string) {
  return async (job: SnapshotJob) => {
    if (job.kind === "push") {
      const jobId = crypto.randomUUID();
      bundles.set(jobId, job.bundle);
      await producer.send("XADD", [STREAM, "*",
        "kind", "push", "jobId", jobId, "projectId", projectId, "userId", userId,
        "commitHash", job.commitHash, "n", String(job.n)]);
    } else {
      await producer.send("XADD", [STREAM, "*",
        "kind", "mark", "projectId", projectId, "commitHash", job.commitHash, "n", String(job.n)]);
    }
  };
}

// Advance durableCodebaseN only forward (never regress if a stale mark trails a newer
// push). The isNull branch matters: `NULL < n` is NULL (not true) in SQL, so without it
// the very first advance on a fresh project (durableCodebaseN = NULL) would be skipped.
async function advanceDurable(projectId: string, n: number) {
  await db
    .update(project)
    .set({ durableCodebaseN: n })
    .where(and(eq(project.id, projectId), or(isNull(project.durableCodebaseN), lt(project.durableCodebaseN, n))));
}

async function handle(fields: Record<string, string>) {
  const { kind, projectId, commitHash } = fields;
  const n = Number(fields.n);
  if (kind === "push") {
    const bytes = bundles.get(fields.jobId);
    bundles.delete(fields.jobId);
    if (!bytes) return; // lost in-flight (process restart) — round is re-done later
    const key = snapshotKey(fields.userId, projectId, commitHash);
    await r2.write(key, bytes);
    await db.update(project).set({ latestSnapshotKey: key, updatedAt: new Date() }).where(eq(project.id, projectId));
    lastPushed.set(projectId, commitHash);
    await advanceDurable(projectId, n); // codebase now durable to n
  } else if (kind === "mark") {
    // No-op round (no new commit): the marker may advance only if HEAD is durably pushed.
    if (lastPushed.get(projectId) === commitHash) await advanceDurable(projectId, n);
  }
}

// Start the single background consumer. The queue is ephemeral (bundle bytes live in
// this process, recovery truth is R2 + Postgres), so at startup we DELETE the stream —
// clearing any jobs orphaned by a prior crash (their bytes are gone; those rounds are
// re-done via the clamp) — and read from `0`, which avoids a start-vs-enqueue race.
// Per-job errors are logged and skipped — a failed push leaves durableCodebaseN behind
// (safe), and the next full bundle self-heals it.
export function startSnapshotWorker() {
  const consumer = new RedisClient(URL); // its own connection: XREAD BLOCK is blocking
  (async () => {
    await producer.send("DEL", [STREAM]).catch(() => {});
    let lastId = "0";
    for (;;) {
      try {
        const res = (await consumer.send("XREAD", ["BLOCK", "0", "COUNT", "20", "STREAMS", STREAM, lastId])) as
          | Record<string, [string, string[]][]>
          | null;
        const entries = res?.[STREAM];
        if (!entries) continue;
        for (const [id, flat] of entries) {
          lastId = id;
          const fields: Record<string, string> = {};
          for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
          try {
            await handle(fields);
          } catch (e) {
            console.log(JSON.stringify({ event: "snapshot_worker_error", id, message: String(e) }));
          }
        }
      } catch (e) {
        console.log(JSON.stringify({ event: "snapshot_worker_read_error", message: String(e) }));
        await Bun.sleep(1000); // back off on a connection blip, then retry
      }
    }
  })();
}
