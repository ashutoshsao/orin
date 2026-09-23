import { describe, expect, test } from "bun:test";
import { connectHmr, moduleUrlPath, WS_TOKEN_RE, type SocketLike } from "./hmrListener";

const URL_ = "https://8080-sbx.e2b.app";
// Shape of the real bundle, reduced to the line the scrape depends on.
const CLIENT_JS = 'const importMetaUrl=new URL(import.meta.url);const wsToken = "OuyDGBPtaQeO";const base=';

// A transform error exactly as a live Vite 8 sent it.
const ERROR_PAYLOAD = JSON.stringify({
  type: "error",
  err: {
    message: "Transform failed with 1 error:\n\n[PARSE_ERROR] Unexpected token.\n   ╭─[ src/App.tsx:3:1 ]",
    stack: "    at transformWithOxc (…)",
    id: "/home/user/react-template/src/App.tsx",
    plugin: "vite:oxc",
    loc: { file: "/home/user/react-template/src/App.tsx", line: 4103, column: 23 },
  },
});

function harness(opts: { client?: string; clientOk?: boolean; moduleStatus?: number[] } = {}) {
  const sockets: SocketLike[] = [];
  const fetched: string[] = [];
  let call = 0;
  const fetchImpl = (async (url: string) => {
    fetched.push(url);
    if (url.endsWith("/@vite/client")) {
      const ok = opts.clientOk ?? true;
      return { ok, text: async () => opts.client ?? CLIENT_JS } as Response;
    }
    const status = (opts.moduleStatus ?? [500])[Math.min(call++, (opts.moduleStatus ?? [500]).length - 1)];
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as unknown as typeof fetch;

  const socketFactory = (url: string): SocketLike => {
    const s: SocketLike & { url?: string; closed?: boolean } = {
      url, closed: false, onmessage: null, onclose: null, onerror: null,
      close() { s.closed = true; },
    };
    sockets.push(s);
    return s;
  };
  return { fetchImpl, socketFactory, sockets, fetched };
}

describe("moduleUrlPath", () => {
  test("strips the sandbox workdir", () => {
    expect(moduleUrlPath("/home/user/react-template/src/App.tsx")).toBe("/src/App.tsx");
  });
  // `loc.file` pointed at vite's own internals in a live run — never invent a path we can't verify.
  test("refuses a path outside the workspace", () => {
    expect(moduleUrlPath("/home/user/react-template/node_modules/vite/dist/x.js")).toBe("/node_modules/vite/dist/x.js");
    expect(moduleUrlPath("/elsewhere/App.tsx")).toBeNull();
    expect(moduleUrlPath(undefined)).toBeNull();
  });
});

describe("token scrape", () => {
  test("matches the shape Vite actually serves", () => {
    expect(WS_TOKEN_RE.exec(CLIENT_JS)?.[1]).toBe("OuyDGBPtaQeO");
  });
});

describe("connectHmr", () => {
  test("records a transform error off the socket", async () => {
    const h = harness();
    const seen: string[] = [];
    const l = await connectHmr(URL_, { ...h, onError: (e) => seen.push(e.message) });
    expect(l).not.toBeNull();
    expect(l!.error).toBeNull();

    h.sockets[0]!.onmessage!({ data: ERROR_PAYLOAD });
    expect(l!.error?.id).toBe("/home/user/react-template/src/App.tsx");
    expect(l!.error?.message).toContain("PARSE_ERROR");
    expect(seen).toHaveLength(1);
  });

  test("revalidate clears the error only once the module serves again", async () => {
    const h = harness({ moduleStatus: [500, 200] });
    const l = await connectHmr(URL_, h);
    h.sockets[0]!.onmessage!({ data: ERROR_PAYLOAD });

    expect(await l!.revalidate()).toBe(true);   // 500 — still broken
    expect(l!.error).not.toBeNull();
    expect(await l!.revalidate()).toBe(false);  // 200 — fixed
    expect(l!.error).toBeNull();
    expect(h.fetched).toContain(`${URL_}/src/App.tsx`);
  });

  test("ignores updates and junk frames", async () => {
    const h = harness();
    const l = await connectHmr(URL_, h);
    h.sockets[0]!.onmessage!({ data: JSON.stringify({ type: "update", updates: [] }) });
    h.sockets[0]!.onmessage!({ data: "not json" });
    expect(l!.error).toBeNull();
  });

  // Losing the overlay is a missing nicety; throwing here would fail a build over it.
  test("degrades to null when the token can't be found", async () => {
    expect(await connectHmr(URL_, harness({ client: "no token here" }))).toBeNull();
  });

  test("degrades to null when the client bundle isn't served", async () => {
    expect(await connectHmr(URL_, harness({ clientOk: false }))).toBeNull();
  });
});
