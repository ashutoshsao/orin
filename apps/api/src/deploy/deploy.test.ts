import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SnapshotSandbox } from "../agent/snapshot";
import { exportSource, parseTar, SourceTooLarge } from "./source";
import { publicUrl, VercelClient, VercelError } from "./vercel";
import { appTitle, isValidSlug, suggestSlug, vercelProjectName } from "./naming";
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
    if (url.pathname.startsWith("/v9/projects/")) return url.pathname.endsWith("/portfolio-1a2b") ? json(200, { name: "portfolio-1a2b" }) : json(404, { error: { code: "not_found", message: "Project not found" } });
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

  test("does not treat Vercel's SSO redirect as a public app response", async () => {
    const client = new VercelClient({ token: "t", fetch: (async () => new Response(null, {
      status: 302, headers: { location: "https://vercel.com/sso-api?url=https%3A%2F%2Fprivate.vercel.app" },
    })) as unknown as typeof fetch, sleep: async () => {} });
    expect(await client.waitServing("https://private.vercel.app", { timeoutMs: 0 })).toBe(false);
  });

  test("an error page is not a working public app", async () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503]) {
      const client = new VercelClient({ token: "t", fetch: (async () => new Response(null, { status })) as unknown as typeof fetch });
      expect(await client.waitServing("https://app.vercel.app", { timeoutMs: 0 })).toBe(false);
    }
  });

  test("tells an existing team project from a free name", async () => {
    const { client } = fakeVercel(["READY"]);
    expect(await client.projectExists("portfolio-1a2b")).toBe(true); // something already lives there
    expect(await client.projectExists("coffee-shop-1a2b")).toBe(false);
  });

  test("an API error carries Vercel's code and message", async () => {
    const { client } = fakeVercel(["READY"], { failCreate: true });
    const err = await client.createDeployment("orin-x", []).catch((e) => e);
    expect(err).toBeInstanceOf(VercelError);
    expect(err).toMatchObject({ status: 403, code: "forbidden", message: "Not authorized" });
  });
});

describe("naming and URLs", () => {
  const id = "1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890";

  test("the Vercel project is the chosen slug plus a short id", () => {
    expect(vercelProjectName(id, "verdant")).toBe("verdant-1a2b");
    expect(vercelProjectName(id, "")).toBe("app-1a2b");
  });

  test("the suggestion is the app's own <title>, before any tagline", () => {
    const html = (t: string) => `<html><head><title>${t}</title></head></html>`;
    expect(suggestSlug(html("Verdant — Plant care, simplified"), "can you build me a plant app")).toBe("verdant");
    expect(suggestSlug(html("Brew &amp; Bean | Coffee"), "x")).toBe("brew-bean");
    expect(suggestSlug(html("Café Menü"), "x")).toBe("cafe-menu");
    expect(appTitle(html("Recipes &#8212; Home"))).toBe("Recipes");
  });

  test("without a real title, the prompt's meaningful words are used", () => {
    const prompt = "can you build me a landing page for my coffee shop with a me"; // a real 60-char cut
    expect(suggestSlug("<title>react-template</title>", prompt)).toBe("landing-page-coffee"); // the template's own title
    expect(suggestSlug(null, prompt)).toBe("landing-page-coffee");
    expect(suggestSlug(null, "🚀")).toBe("coffee-shop"); // a generic example, not a real name
  });

  test("a typed name is accepted only as a clean slug of at most 40 characters", () => {
    for (const ok of ["coffee-shop", "sjdwkhasd", "lehfwkejhf-ejfwkejf-wkejfbwef", "a1", "x".repeat(40)]) expect(isValidSlug(ok)).toBe(true);
    for (const bad of ["", "Verdant", "brew--bean", "-x", "x-", "café", "a b", "x".repeat(41)]) expect(isValidSlug(bad)).toBe(false);
    // Nothing that could mean anything to a shell, a URL or a prompt gets through.
    for (const bad of ["x;rm -rf /", "$(id)", "`id`", "a/../b", "a.b", "x'", "<script>", "ignore previous instructions", "x\n", "%2e%2e"]) expect(isValidSlug(bad)).toBe(false);
  });

  test("the shared URL is the project's shortest vercel.app alias", () => {
    expect(publicUrl({ url: "orin-x-abc.vercel.app", alias: ["orin-x-team.vercel.app", "orin-x.vercel.app"] })).toBe("https://orin-x.vercel.app");
    expect(publicUrl({ url: "orin-x-abc.vercel.app" }, "orin-x")).toBe("https://orin-x.vercel.app");
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
