import { WORKDIR } from "./tools";

// Watching the app's compile errors from OUTSIDE the sandbox (spec 9).
//
// The failure users actually hit isn't the dev server dying — Vite survives a syntax error in a
// component, keeps serving, answers 200 at `/`, and shows its red overlay inside the iframe. Our
// status bar then says "preview · live" while the user reads a stack trace.
//
// Vite broadcasts those errors on its HMR WebSocket, so the orchestrator can subscribe as just
// another client. That matters: the obvious alternative — a shim inside the app — is code the
// agent rewrites, and needs an E2B image rebuild. Nothing here touches the sandbox.
//
// Verified against a live sandbox (Vite 8), including the parts that aren't obvious:
//   - the socket is token-guarded, but the token is in the served client bundle
//   - editing a file sends `update`, NOT `error`; the transform only runs when a client REQUESTS
//     the module, and the error follows that
//   - there is NO "recovered" event when the code is fixed — hence `revalidate()`
export type HmrError = {
  message: string;
  // Absolute path in the sandbox, e.g. /home/user/react-template/src/App.tsx
  id?: string;
  plugin?: string;
};

export type HmrListener = {
  // The app's current compile error, or null. Read by the status bar and the round boundary.
  readonly error: HmrError | null;
  // Re-check whether the recorded error still holds, by requesting the module again: 500 = still
  // broken, 200 = fixed. Vite sends nothing on recovery, so asking is the only reliable answer.
  revalidate: () => Promise<boolean>;
  close: () => void;
};

// Minimal shape of a WebSocket, so tests don't need a real one.
export type SocketLike = {
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e?: unknown) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  close: () => void;
};

export const WS_TOKEN_RE = /wsToken\s*=\s*["']([^"']+)["']/;
const MESSAGE_MAX = 4_000;

// `err.id` is a path inside the sandbox; the dev server serves it at the same path minus WORKDIR.
export function moduleUrlPath(id: string | undefined): string | null {
  if (!id || !id.startsWith(WORKDIR)) return null;
  const rest = id.slice(WORKDIR.length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

export async function connectHmr(
  previewUrl: string,
  opts: {
    onError?: (e: HmrError) => void;
    fetchImpl?: typeof fetch;
    socketFactory?: (url: string, protocol: string) => SocketLike;
  } = {},
): Promise<HmrListener | null> {
  const doFetch = opts.fetchImpl ?? fetch;

  // The token scrape is a regex against Vite's client bundle — undocumented, and a Vite upgrade
  // could move it. Every failure here returns null (no listener) rather than throwing: losing the
  // error overlay is a missing nicety, but failing a build over it would be a real outage.
  let token: string | undefined;
  try {
    const client = await doFetch(`${previewUrl}/@vite/client`, { signal: AbortSignal.timeout(5_000) });
    if (!client.ok) return null;
    token = WS_TOKEN_RE.exec(await client.text())?.[1];
  } catch {
    return null;
  }
  if (!token) return null;

  let socket: SocketLike;
  try {
    const make = opts.socketFactory ?? ((u, p) => new WebSocket(u, p) as unknown as SocketLike);
    socket = make(`${previewUrl.replace(/^http/, "ws")}/?token=${token}`, "vite-hmr");
  } catch {
    return null;
  }

  let error: HmrError | null = null;
  let closed = false;

  socket.onmessage = (e) => {
    let payload: { type?: string; err?: { message?: string; id?: string; plugin?: string } };
    try {
      payload = JSON.parse(String(e.data));
    } catch {
      return; // not ours to police
    }
    if (payload.type !== "error" || !payload.err) return;
    error = {
      message: String(payload.err.message ?? "").slice(0, MESSAGE_MAX),
      id: payload.err.id,
      plugin: payload.err.plugin,
    };
    opts.onError?.(error);
  };
  socket.onclose = () => { closed = true; };
  socket.onerror = () => { /* the close handler does the bookkeeping */ };

  return {
    get error() {
      return error;
    },
    async revalidate() {
      if (!error) return false;
      const path = moduleUrlPath(error.id);
      // No usable path — keep the error rather than silently claiming the app is fine.
      if (!path) return true;
      try {
        const res = await doFetch(`${previewUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) {
          error = null;
          return false;
        }
      } catch {
        // Couldn't ask; assume the error stands.
      }
      return true;
    },
    close() {
      if (!closed) socket.close();
      closed = true;
    },
  };
}
