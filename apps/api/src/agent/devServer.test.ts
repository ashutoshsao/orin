import { describe, expect, test } from "bun:test";
import { startDevServer, type DevServerSandbox } from "./devServer";

// A fake sandbox + a fake clock. Time is injected so a test for "gives up after 60s" runs
// instantly and deterministically — the real bug was about elapsed time, so the tests have
// to be able to talk about elapsed time.
function fake(opts: {
  // One entry per probe attempt: a status number, "hang" (attempt burns its full timeout),
  // or "refuse" (connection error).
  probes: (number | "hang" | "refuse")[];
  // Exit the dev server before probe number N (0-based).
  exitBefore?: number;
  exitCode?: number;
  stderr?: string;
}) {
  const commands: string[] = [];
  let clock = 0;
  let attempt = 0;
  const handle = { exitCode: undefined as number | undefined, stderr: opts.stderr ?? "", wait: async () => {} };

  const sandbox: DevServerSandbox = {
    commands: {
      run: (async (cmd: string) => {
        commands.push(cmd);
        return handle;
      }) as unknown as DevServerSandbox["commands"]["run"],
    },
    getHost: (port: number) => `${port}-sbx.e2b.app`,
  };

  const fetchImpl = (async () => {
    const i = attempt++;
    if (opts.exitBefore !== undefined && i >= opts.exitBefore) handle.exitCode = opts.exitCode ?? 1;
    const p = opts.probes[Math.min(i, opts.probes.length - 1)];
    if (p === "hang") {
      clock += 2_000; // the attempt timeout fired
      throw new Error("TimeoutError");
    }
    if (p === "refuse") throw new Error("ECONNREFUSED");
    return { status: p, ok: p >= 200 && p < 300 } as Response;
  }) as unknown as typeof fetch;

  return {
    sandbox,
    commands,
    args: {
      fetchImpl,
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
    },
    // Let the exit land before the first probe rather than after one.
    killNow: () => { handle.exitCode = opts.exitCode ?? 1; },
    handle,
  };
}

describe("startDevServer", () => {
  test("ready as soon as the app answers 200", async () => {
    const f = fake({ probes: ["refuse", "refuse", 200] });
    const out = await startDevServer(f.sandbox, f.args);
    expect(out).toEqual({ kind: "ready", url: "https://8080-sbx.e2b.app", httpStatus: "200", ms: 1_000 });
    expect(f.commands[0]).toBe("bun run dev --host --port 8080");
  });

  test("a dead dev server is reported with its stderr, not waited out", async () => {
    const f = fake({ probes: ["refuse"], exitBefore: 0, exitCode: 1, stderr: "  SyntaxError: Unexpected token\n" });
    const out = await startDevServer(f.sandbox, f.args);
    expect(out).toEqual({
      kind: "exited",
      url: "https://8080-sbx.e2b.app",
      exitCode: 1,
      stderr: "SyntaxError: Unexpected token",
      ms: 500,
    });
  });

  // The regression the whole module exists for: 30 slow attempts used to take 5 minutes.
  test("a hanging proxy is bounded by the deadline, not by the attempt count", async () => {
    const f = fake({ probes: ["hang"] });
    const out = await startDevServer(f.sandbox, f.args);
    expect(out.kind).toBe("unreachable");
    expect(out.ms).toBeLessThanOrEqual(60_000 + 2_500);
  });

  test("says it's slow once, and only once, past the threshold", async () => {
    const seen: number[] = [];
    const f = fake({ probes: ["refuse"] });
    await startDevServer(f.sandbox, { ...f.args, onProgress: (p) => seen.push(p.ms) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(15_000);
  });

  test("keeps the last status it saw when it gives up", async () => {
    const f = fake({ probes: [502] });
    const out = await startDevServer(f.sandbox, f.args);
    expect(out).toMatchObject({ kind: "unreachable", httpStatus: "502" });
  });

  // The agent loop keeps this handle to catch a crash that happens AFTER we stopped waiting.
  test("hands the running command back to the caller", async () => {
    const f = fake({ probes: [200] });
    let given: unknown = null;
    await startDevServer(f.sandbox, { ...f.args, onStarted: (h) => { given = h; } });
    expect(given).toBe(f.handle);
  });

  test("a server that dies late is reported as exited, not unreachable", async () => {
    const f = fake({ probes: ["refuse"], exitBefore: 40, exitCode: 137 });
    const out = await startDevServer(f.sandbox, f.args);
    expect(out).toMatchObject({ kind: "exited", exitCode: 137 });
  });
});
