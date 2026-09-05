import { RedisClient } from "bun";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, project, snapshot } from "@repo/db";
import { r2, snapshotKey, snapshotPrefix } from "./r2";
import { bundlesToDelete } from "./retention";
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
// `rewindGen` is the project's generation when the session started: every job carries it,
// and the worker drops jobs from a generation a rewind has since ended.
export function snapshotEnqueuer(projectId: string, userId: string, rewindGen: number) {
  return async (job: SnapshotJob) => {
    if (job.kind === "push") {
      const jobId = crypto.randomUUID();
      bundles.set(jobId, job.bundle);
      await producer.send("XADD", [STREAM, "*",
        "kind", "push", "jobId", jobId, "projectId", projectId, "userId", userId,
        "commitHash", job.commitHash, "n", String(job.n), "gen", String(rewindGen)]);
    } else {
      await producer.send("XADD", [STREAM, "*",
        "kind", "mark", "projectId", projectId, "commitHash", job.commitHash, "n", String(job.n), "gen", String(rewindGen)]);
    }
  };
}

// `db` or a transaction handle — the push path advances inside its transaction, marks don't need one.
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Advance durableCodebaseN only forward (never regress if a stale mark trails a newer
// push). The isNull branch matters: `NULL < n` is NULL (not true) in SQL, so without it
// the very first advance on a fresh project (durableCodebaseN = NULL) would be skipped.
async function advanceDurable(exec: Exec, projectId: string, gen: number, n: number) {
  await exec
    .update(project)
    .set({ durableCodebaseN: n })
    .where(and(
      eq(project.id, projectId),
      eq(project.rewindGen, gen),
      or(isNull(project.durableCodebaseN), lt(project.durableCodebaseN, n)),
    ));
}

async function currentGen(projectId: string): Promise<number | null> {
  const [row] = await db.select({ gen: project.rewindGen }).from(project).where(eq(project.id, projectId));
  return row ? row.gen : null;
}

function logWorker(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

async function handle(fields: Record<string, string>) {
  const { kind, projectId, commitHash } = fields;
  const n = Number(fields.n);
  const gen = Number(fields.gen);
  if (kind === "push") {
    const bytes = bundles.get(fields.jobId);
    bundles.delete(fields.jobId);
    if (!bytes) return; // lost in-flight (process restart) — round is re-done later
    // Cheap early exit: don't upload a bundle a rewind has already made obsolete.
    if ((await currentGen(projectId)) !== gen) return logWorker("snapshot_job_stale", { projectId, commitHash, gen });
    const key = snapshotKey(fields.userId, projectId, commitHash);
    await r2.write(key, bytes);
    // The authoritative check. The UPDATE ... WHERE rewind_gen = gen takes the project row
    // lock, so a rewind (which bumps the gen on that row) runs wholly before or after this
    // transaction — never between the pointer move and the row insert.
    const landed = await db.transaction(async (tx) => {
      const moved = await tx
        .update(project)
        .set({ latestSnapshotKey: key, updatedAt: new Date() })
        .where(and(eq(project.id, projectId), eq(project.rewindGen, gen)))
        .returning({ id: project.id });
      if (moved.length === 0) return false;
      await tx.insert(snapshot).values({ projectId, commitHash, n, key }); // a rewind point
      await advanceDurable(tx, projectId, gen, n); // codebase now durable to n
      return true;
    });
    if (!landed) {
      // A rewind won the race after the upload: this object is unreferenced, remove it.
      await r2.delete(key).catch(() => {});
      return logWorker("snapshot_job_stale", { projectId, commitHash, gen });
    }
    lastPushed.set(projectId, commitHash);
    await pruneBundles(fields.userId, projectId, key);
  } else if (kind === "mark") {
    // No-op round (no new commit): the marker may advance only if HEAD is durably pushed.
    if (lastPushed.get(projectId) === commitHash) await advanceDurable(db, projectId, gen, n);
  }
}

// Keep the last KEEP_BUNDLES bundles for a project (7.1). Runs only after a push fully
// landed, so a failed upload never deletes anything and a project is never left at zero.
// Lists the prefix rather than trusting snapshot rows, so it also sweeps bundles orphaned
// by earlier rewinds. Best-effort: a failure just leaves extra objects for the next push.
async function pruneBundles(userId: string, projectId: string, latestKey: string) {
  try {
    const listed = await r2.list({ prefix: snapshotPrefix(userId, projectId), maxKeys: 1000 });
    const doomed = bundlesToDelete(listed.contents ?? [], latestKey);
    for (const key of doomed) await r2.delete(key);
    if (doomed.length) logWorker("snapshot_bundles_pruned", { projectId, count: doomed.length });
  } catch (e) {
    logWorker("snapshot_prune_error", { projectId, message: String(e) });
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
