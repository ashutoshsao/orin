import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SnapshotSandbox } from "../agent/snapshot";
import { exportSource, parseTar, SourceTooLarge } from "./source";
import { deployName, publicUrl, VercelClient, VercelError } from "./vercel";
import { deployProject, type DeploySeams } from "./deployProject";

const LONG = `src/${"deeply-nested-folder/".repeat(6)}Component.tsx`; // > 100 chars → pax header

// The archive comes from real `git archive`, the same command the sandbox runs — a
// hand-built tar would only test this parser against itself.
async function gitArchive(): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "orin-tar-"));
  await $`git init -q ${dir}`;
  await Bun.write(join(dir, "index.html"), "<div id=root></div>");
  await Bun.write(join(dir, "src/main.tsx"), "import App from './App'");
  await Bun.write(join(dir, LONG), "export default 1");
  await Bun.write(join(dir, "public/logo.bin"), new Uint8Array([0, 255, 1, 254]));
  await Bun.write(join(dir, ".gitignore"), "dist\n");
  await Bun.write(join(dir, "dist/out.js"), "ignored");
  await $`git -C ${dir} add -A && git -C ${dir} -c user.email=t@t -c user.name=t commit -qm x`.quiet();
  return new Uint8Array(await $`git -C ${dir} archive --format=tar HEAD`.arrayBuffer());
}

describe("parseTar on git archive output", () => {
  test("returns every committed file with its bytes, long paths included, ignored files not", async () => {
    const files = parseTar(await gitArchive());
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.bytes]));
    expect(Object.keys(byPath).sort()).toEqual([".gitignore", "index.html", "public/logo.bin", LONG, "src/main.tsx"].sort());
    expect(new TextDecoder().decode(byPath["src/main.tsx"])).toBe("import App from './App'");
    expect([...byPath["public/logo.bin"]!]).toEqual([0, 255, 1, 254]);
  });
});

function fakeSandbox(stdout: string) {
  const commands: string[] = [];
  const reads: string[] = [];
  const sandbox: SnapshotSandbox = {
    commands: { run: (async (cmd: string) => { commands.push(cmd); return { stdout, stderr: "", exitCode: 0 }; }) as SnapshotSandbox["commands"]["run"] },
    files: { read: (async (p: string) => { reads.push(p); return new Uint8Array(1024); }) as SnapshotSandbox["files"]["read"] },
  };
  return { sandbox, commands, reads };
}
const COMMIT = "c".repeat(40);

describe("exportSource", () => {
  test("an oversize archive is never read out, and the tar is removed", async () => {
    const f = fakeSandbox(`${COMMIT}\n${30 * 1024 * 1024}\n`);
    await expect(exportSource(f.sandbox)).rejects.toBeInstanceOf(SourceTooLarge);
    expect(f.reads).toHaveLength(0);
    expect(f.commands.at(-1)).toStartWith("rm -f /tmp/orin-deploy-");
  });

  test("unreadable output fails loudly instead of deploying nothing", async () => {
    const f = fakeSandbox("fatal: not a git repository\n");
    await expect(exportSource(f.sandbox)).rejects.toThrow("source export unreadable");
  });
});

// Answers for Vercel and records what was asked.
function fakeVercel(states: string[], opts: { failCreate?: boolean; aliasWarmup?: number } = {}) {
  opts.aliasWarmup ??= 0;
  const calls: { method: string; url: URL; headers: Record<string, string>; body?: unknown }[] = [];
  let polls = 0;
  let aliasPolls = 0;
  const fetchFn = (async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: init.method!, url, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/v2/files") return json(200, {});
    if (url.pathname === "/v13/deployments") {
      return opts.failCreate
        ? json(403, { error: { code: "forbidden", message: "Not authorized" } })
        : json(200, { id: "dpl_1", url: "orin-x-abc.vercel.app", readyState: "QUEUED" });
    }
    if (url.pathname === "/v13/deployments/dpl_1") {
      const readyState = states[Math.min(polls++, states.length - 1)];
      return json(200, { id: "dpl_1", url: "orin-x-abc.vercel.app", readyState, alias: ["orin-x-team.vercel.app", "orin-x.vercel.app"], errorMessage: readyState === "ERROR" ? "Command \"bun run build\" exited with 1" : undefined });
    }
    if (url.host === "orin-x.vercel.app") return new Response("", { status: aliasPolls++ < opts.aliasWarmup! ? 404 : 200 });
    if (url.pathname === "/v3/deployments/dpl_1/events") return json(200, [{ text: "src/App.tsx(3,1): error TS1005" }, { text: "exited with 1" }]);
    return json(404, {});
  }) as unknown as typeof fetch;
  const client = new VercelClient({ token: "tok", teamId: "team_1", fetch: fetchFn, sleep: async () => {} });
  return { client, calls };
}

describe("VercelClient", () => {
  test("uploads each file by sha1 to the team, then deploys to production with auto-detection", async () => {
    const { client, calls } = fakeVercel(["READY"]);
    const refs = await client.uploadFiles([{ path: "index.html", bytes: new TextEncoder().encode("hi") }]);
    await client.createDeployment("orin-x", refs);

    const upload = calls[0]!;
    expect(upload.url.searchParams.get("teamId")).toBe("team_1");
    expect(upload.headers.Authorization).toBe("Bearer tok");
    expect(upload.headers["x-vercel-digest"]).toBe("c22b5f9178342609428d6f51b2c5af4c0bde6a42"); // sha1("hi")
    expect(refs).toEqual([{ file: "index.html", sha: "c22b5f9178342609428d6f51b2c5af4c0bde6a42", size: 2 }]);

    const create = calls[1]!;
    expect(create.url.searchParams.get("skipAutoDetectionConfirmation")).toBe("1");
    expect(create.body).toMatchObject({ name: "orin-x", target: "production", files: refs });
    expect(create.body).not.toHaveProperty("projectSettings"); // framework is detected, not assumed
  });

  test("polls until the deployment reaches a final state", async () => {
    const { client, calls } = fakeVercel(["QUEUED", "BUILDING", "READY"]);
    expect((await client.waitReady("dpl_1")).readyState).toBe("READY");
    expect(calls.filter((c) => c.url.pathname === "/v13/deployments/dpl_1")).toHaveLength(3);
  });

  test("waits out the alias's 404 after READY before calling the link live", async () => {
    const { client, calls } = fakeVercel(["READY"], { aliasWarmup: 2 });
    expect(await client.waitServing("https://orin-x.vercel.app")).toBe(true);
    const visits = calls.filter((c) => c.url.host === "orin-x.vercel.app");
    expect(visits).toHaveLength(3);
    expect(visits[0]!.headers.Authorization).toBeUndefined(); // checked as a visitor would see it
  });

  test("an API error carries Vercel's code and message", async () => {
    const { client } = fakeVercel(["READY"], { failCreate: true });
    const err = await client.createDeployment("orin-x", []).catch((e) => e);
    expect(err).toBeInstanceOf(VercelError);
    expect(err).toMatchObject({ status: 403, code: "forbidden", message: "Not authorized" });
  });
});

describe("naming and URLs", () => {
  test("the link is the app's name, made URL-safe, plus a short id", () => {
    const id = "1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890";
    expect(deployName(id, "Recipe Box!")).toBe("recipe-box-1a2b");
    expect(deployName(id, "  Café   Menü — v2 ")).toBe("cafe-menu-v2-1a2b");
    expect(deployName(id, "🚀🚀")).toBe("app-1a2b"); // nothing usable left
    expect(deployName(id, "x".repeat(80))).toBe(`${"x".repeat(40)}-1a2b`);
    expect(deployName(id, `${"a".repeat(39)} b`)).toBe(`${"a".repeat(39)}-1a2b`); // no dash left dangling at the cut
  });
  test("the shared URL is the project's shortest vercel.app alias", () => {
    expect(publicUrl({ url: "orin-x-abc.vercel.app", alias: ["orin-x-team.vercel.app", "orin-x.vercel.app"] })).toBe("https://orin-x.vercel.app");
    expect(publicUrl({ url: "orin-x-abc.vercel.app" })).toBe("https://orin-x-abc.vercel.app");
  });
});

describe("deployProject", () => {
  function seams(states: string[], exportFails?: Error) {
    const { client } = fakeVercel(states);
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const saved: unknown[] = [];
    const s: DeploySeams = {
      projectId: "1a2b3c4d-0000-0000-0000-000000000000",
      vercelProject: "orin-x",
      exportSource: async () => {
        if (exportFails) throw exportFails;
        return { commit: COMMIT, files: [{ path: "index.html", bytes: new Uint8Array([1]) }] };
      },
      client,
      emit: (event, data) => events.push({ event, data }),
      save: async (r) => { saved.push(r); },
    };
    return { s, events, saved };
  }

  test("a successful build is saved and reported with its URL", async () => {
    const { s, events, saved } = seams(["BUILDING", "READY"]);
    const r = await deployProject(s);
    expect(r).toEqual({ url: "https://orin-x.vercel.app", commit: COMMIT, deploymentId: "dpl_1", vercelProject: "orin-x" });
    expect(saved).toEqual([r]);
    expect(events.map((e) => e.event)).toEqual(["deploy_started", "deploy_building", "deploy_ready"]);
  });

  test("a failed build is reported with the end of its log, and nothing is saved", async () => {
    const { s, events, saved } = seams(["ERROR"]);
    expect(await deployProject(s)).toBeNull();
    expect(saved).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ event: "deploy_failed", data: { message: "Command \"bun run build\" exited with 1", log: "src/App.tsx(3,1): error TS1005\nexited with 1" } });
  });

  test("an oversize app gets an explanation it can act on, not a stack trace", async () => {
    const { s, events } = seams(["READY"], new SourceTooLarge(30_000_000));
    expect(await deployProject(s)).toBeNull();
    expect(events.at(-1)!.data!.message).toStartWith("The app's files are over the 25 MB deploy limit");
  });
});
