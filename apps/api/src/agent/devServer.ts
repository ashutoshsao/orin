import type { Sandbox } from "e2b";
import { WORKDIR } from "./tools";

// Starting the app's dev server and waiting for it to answer (8.x). Split out of agent.ts
// so the waiting logic is testable without a live E2B VM — the two production bugs this
// replaces were both in code that no test could reach.
//
// Budgets are WALL-CLOCK, not attempt counts. The bug: the old loop ran 30 attempts with a
// bare `fetch` and `sleep(500)`, intending ~15s — but a bare fetch has no timeout, so when
// the E2B proxy slow-502'd each attempt took ~10s and the "15 second" wait became FIVE
// MINUTES of a silent "Building your app…". An attempt cap can't bound time; a deadline can.
export const PREVIEW_DEADLINE_MS = 60_000;
// Per attempt. The proxy either answers fast or isn't ready — waiting longer never helps,
// it just eats the budget.
export const PREVIEW_ATTEMPT_TIMEOUT_MS = 2_000;
// A cold Vite answers in a few seconds. Past this, say so rather than leaving a blank feed.
export const PREVIEW_SLOW_AFTER_MS = 15_000;
export const PREVIEW_POLL_MS = 500;
// Enough stderr to carry a Vite/esbuild error, little enough to sit in an SSE event.
export const STDERR_TAIL_CHARS = 2_000;

// Only what we use, so tests can pass a fake.
export type DevServerSandbox = {
  commands: Pick<Sandbox["commands"], "run">;
  getHost: (port: number) => string;
};

// The background command, narrowed to what waiting needs: `exitCode` is undefined while it
// runs, and the SDK accumulates `stderr` for us.
export type DevServerHandle = {
  exitCode?: number;
  stderr: string;
  wait?: () => Promise<unknown>;
};

export type PreviewProgress = { kind: "slow"; url: string; ms: number; httpStatus: string };

export type PreviewOutcome =
  | { kind: "ready"; url: string; httpStatus: string; ms: number }
  // The dev server process died — we know WHY the preview never came up.
  | { kind: "exited"; url: string; exitCode: number; stderr: string; ms: number }
  // Still running, still not answering: out of budget.
  | { kind: "unreachable"; url: string; httpStatus: string; ms: number };

const tail = (s: string, n = STDERR_TAIL_CHARS) => s.trim().slice(-n);

export async function startDevServer(
  sandbox: DevServerSandbox,
  opts: {
    port?: number;
    onProgress?: (p: PreviewProgress) => void;
    // Hands back the running command so the caller can keep watching it after we stop
    // waiting — the agent loop checks it at each round boundary to catch a late crash.
    onStarted?: (handle: DevServerHandle) => void;
    // Seams for tests — production uses the real ones.
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    deadlineMs?: number;
    attemptTimeoutMs?: number;
    slowAfterMs?: number;
    pollMs?: number;
  } = {},
): Promise<PreviewOutcome> {
  const port = opts.port ?? 8080;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadlineMs = opts.deadlineMs ?? PREVIEW_DEADLINE_MS;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? PREVIEW_ATTEMPT_TIMEOUT_MS;
  const slowAfterMs = opts.slowAfterMs ?? PREVIEW_SLOW_AFTER_MS;
  const pollMs = opts.pollMs ?? PREVIEW_POLL_MS;

  const started = now();
  const handle = (await sandbox.commands.run(`bun run dev --host --port ${port}`, {
    cwd: WORKDIR,
    background: true,
  })) as DevServerHandle;
  // The SDK rejects this promise when the command exits non-zero. Nobody awaits it (we poll
  // `exitCode` instead), so swallow it here or a crashing dev server becomes an unhandled
  // rejection that takes down the API process.
  handle.wait?.().catch(() => {});
  opts.onStarted?.(handle);

  // Probe the PUBLIC url from here (the orchestrator), not localhost inside the sandbox —
  // this exercises the full path (E2B proxy → Vite host check → app), which is exactly what
  // the browser hits. A localhost probe would bypass the host check and give false confidence.
  const url = `https://${sandbox.getHost(port)}`;
  let httpStatus = "no-response";
  let slowNotified = false;

  const exited = (): PreviewOutcome | null =>
    handle.exitCode === undefined
      ? null
      : { kind: "exited", url, exitCode: handle.exitCode, stderr: tail(handle.stderr ?? ""), ms: now() - started };

  while (now() - started < deadlineMs) {
    // The thing we're waiting for is a process. If it's gone, no amount of polling the port
    // will help — this is the second bug: `bun run dev` was started with `background: true`
    // and nothing ever checked it, so a dev server that died at startup (bad config, missing
    // dependency, port taken) looked identical to a slow boot and burned the whole budget.
    const dead = exited();
    if (dead) return dead;

    try {
      // The timeout is the whole point: it turns an indefinite hang into a retry.
      const res = await doFetch(url, { signal: AbortSignal.timeout(attemptTimeoutMs) });
      httpStatus = String(res.status);
      if (res.ok) return { kind: "ready", url, httpStatus, ms: now() - started };
    } catch {
      // Proxy or server not ready (or this attempt timed out) — retry until the deadline.
    }

    if (!slowNotified && now() - started >= slowAfterMs) {
      slowNotified = true;
      opts.onProgress?.({ kind: "slow", url, ms: now() - started, httpStatus });
    }
    await sleep(pollMs);
  }

  // It may have died during the final sleep; that's a better explanation than "unreachable".
  return exited() ?? { kind: "unreachable", url, httpStatus, ms: now() - started };
}
