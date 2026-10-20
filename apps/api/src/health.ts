import { RedisClient } from "bun";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";

// Deep health for the status page: Postgres (projects, auth) and Redis (the snapshot queue) both answer.
// Not meant for the k8s liveness probe: a database blip shouldn't restart the API. /config stays the probe.
const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");
const TIMEOUT_MS = 3000;

type Check = { ok: boolean; ms?: number; error?: string };

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function check(name: string, run: () => Promise<unknown>): Promise<[string, Check]> {
  const started = performance.now();
  try {
    await within(run(), TIMEOUT_MS);
    return [name, { ok: true, ms: Math.round(performance.now() - started) }];
  } catch (error) {
    return [name, { ok: false, error: (error as Error).message }];
  }
}

export async function health(): Promise<{ ok: boolean; body: { status: string; checks: Record<string, Check> } }> {
  const checks: Record<string, Check> = Object.fromEntries(await Promise.all([
    check("database", () => db.execute(sql`select 1`)),
    check("redis", () => redis.send("PING", [])),
  ]));
  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, body: { status: ok ? "ok" : "degraded", checks } };
}
