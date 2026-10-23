import type { SourceFile } from "./source";

// The four Vercel REST calls a deploy needs: upload files by sha, create a deployment that
// references them, poll it to a final state, and read the build log when it fails. `fetch`
// is injected so tests can answer for Vercel. The token never leaves the API process — the
// sandbox runs untrusted model output, so it must not be able to deploy (or delete) anything.

export type VercelConfig = {
  token: string;
  teamId?: string; // unset → the token's own account (Hobby's personal scope)
  fetch?: typeof fetch;
  api?: string;
  sleep?: (ms: number) => Promise<void>;
};

export type FileRef = { file: string; sha: string; size: number };
export type Deployment = {
  id: string;
  url: string; // without scheme, e.g. orin-1a2b3c4d-abc123.vercel.app
  readyState: string; // QUEUED | INITIALIZING | BUILDING | READY | ERROR | CANCELED
  alias?: string[];
  errorMessage?: string;
};

const FINAL = new Set(["READY", "ERROR", "CANCELED"]);
const UPLOAD_CONCURRENCY = 8;
const LOG_TAIL_LINES = 30;

export class VercelError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// Read from the environment; null means deploys are switched off on this server.
export function vercelFromEnv(): VercelClient | null {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return null;
  return new VercelClient({ token, teamId: process.env.VERCEL_TEAM_ID || undefined });
}

// One Vercel project per Orin project, and its name is the link people see:
// "Recipe Box!" → recipe-box-1a2b → https://recipe-box-1a2b.vercel.app. The id suffix keeps two
// "Todo app"s apart. Called once, at the first deploy — the result is stored and reused, so a
// rename in Orin never moves a shared link. The slug is capped so the whole name stays well
// inside a DNS label (63); Vercel allows lowercase letters, digits and single dashes.
const SLUG_MAX = 40;
export function deployName(projectId: string, appName: string): string {
  const slug = appName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return `${slug || "app"}-${projectId.replace(/-/g, "").slice(0, 4)}`;
}

// The address to share. A production deployment gets the project's stable aliases besides its
// per-deployment url; the shortest *.vercel.app one is the project's own name.
export function publicUrl(d: Pick<Deployment, "url" | "alias">): string {
  const aliases = (d.alias ?? []).filter((a) => a.endsWith(".vercel.app")).sort((a, b) => a.length - b.length);
  return `https://${aliases[0] ?? d.url}`;
}

export class VercelClient {
  private fetch: typeof fetch;
  private api: string;
  private sleep: (ms: number) => Promise<void>;

  constructor(private cfg: VercelConfig) {
    this.fetch = cfg.fetch ?? fetch;
    this.api = cfg.api ?? "https://api.vercel.com";
    this.sleep = cfg.sleep ?? Bun.sleep;
  }

  private async call<T>(method: string, path: string, opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: BodyInit } = {}): Promise<T> {
    const url = new URL(path, this.api);
    if (this.cfg.teamId) url.searchParams.set("teamId", this.cfg.teamId);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.cfg.token}`, ...opts.headers },
      body: opts.body,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error ?? {};
      throw new VercelError(res.status, err.code ?? "unknown", err.message ?? `${method} ${path} → ${res.status}`);
    }
    return json as T;
  }

  // Files are content-addressed by sha1: uploading one Vercel already has is a cheap no-op,
  // so a redeploy only really sends what changed.
  async uploadFiles(files: SourceFile[]): Promise<FileRef[]> {
    const refs: FileRef[] = [];
    for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
      const batch = files.slice(i, i + UPLOAD_CONCURRENCY);
      refs.push(...(await Promise.all(batch.map(async (f) => {
        const sha = new Bun.CryptoHasher("sha1").update(f.bytes).digest("hex");
        await this.call("POST", "/v2/files", {
          headers: { "Content-Type": "application/octet-stream", "x-vercel-digest": sha, "Content-Length": String(f.bytes.length) },
          body: new Blob([f.bytes]),
        });
        return { file: f.path, sha, size: f.bytes.length };
      }))));
    }
    return refs;
  }

  // No projectSettings: Vercel detects the framework from the files (Vite today, Next.js
  // later), exactly as `vercel deploy` did in the probe. skipAutoDetectionConfirmation is what
  // lets the first deploy of a new project accept that detection instead of failing.
  async createDeployment(name: string, files: FileRef[], meta: Record<string, string> = {}): Promise<Deployment> {
    return this.call<Deployment>("POST", "/v13/deployments", {
      query: { skipAutoDetectionConfirmation: "1" },
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, files, target: "production", meta }),
    });
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.call<Deployment>("GET", `/v13/deployments/${id}`);
  }

  async waitReady(id: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<Deployment> {
    const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
    for (;;) {
      const d = await this.getDeployment(id);
      if (FINAL.has(d.readyState)) return d;
      if (Date.now() > deadline) throw new Error(`deployment ${id} still ${d.readyState} after timeout`);
      await this.sleep(opts.intervalMs ?? 3_000);
    }
  }

  // READY isn't "the link works": the project alias is still propagating for a few seconds
  // after it (the first real deploy answered 404 DEPLOYMENT_NOT_FOUND, then 200). Wait until the
  // shared URL serves, so the first click on it never lands on Vercel's 404. Unauthenticated
  // on purpose — this is what a visitor sees.
  async waitServing(url: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<boolean> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    for (;;) {
      const res = await this.fetch(url, { redirect: "manual" }).catch(() => null);
      if (res && res.status !== 404) return true;
      if (Date.now() > deadline) return false;
      await this.sleep(opts.intervalMs ?? 2_000);
    }
  }

  // The end of the build output — what someone (or later the agent) needs to fix the build.
  // Best effort: a failed deploy is reported either way.
  async buildLogTail(id: string): Promise<string> {
    try {
      const events = await this.call<{ text?: string }[]>("GET", `/v3/deployments/${id}/events`, { query: { builds: "1" } });
      return events.map((e) => e.text ?? "").filter(Boolean).slice(-LOG_TAIL_LINES).join("\n");
    } catch {
      return "";
    }
  }
}
