import type { Sandbox } from "e2b";
import { WORKDIR } from "./tools";

// Largest bundle we'll read out of the sandbox (7.1). Real bundles are 45–80 KB; the cap
// exists so a multi-GB repo (committed build output, big assets) never enters API memory —
// `files.read` loads the whole file, so without it one project could OOM the server for all.
export const SNAPSHOT_MAX_BYTES = 25 * 1024 * 1024;

// Only the two sandbox calls we use — lets tests pass a fake instead of a live E2B VM.
export type SnapshotSandbox = {
  commands: Pick<Sandbox["commands"], "run">;
  files: Pick<Sandbox["files"], "read">;
};

export type SnapshotResult =
  | { kind: "nochange" }
  | { kind: "bundle"; hash: string; bundle: Uint8Array }
  | { kind: "oversize"; hash: string; bytes: number };

// Commit this round's files and build a FULL bundle (all history from HEAD) so restore is
// a single fetch and rewind stays possible. The size is measured INSIDE the sandbox before
// read-out; an oversize bundle is never read. The bundle file is removed either way —
// it's been read into memory or is being dropped, and each one is a full copy of history.
export async function snapshotRound(sandbox: SnapshotSandbox, maxBytes = SNAPSHOT_MAX_BYTES): Promise<SnapshotResult> {
  // Stage everything, commit only if the index changed; echo a sentinel otherwise so
  // we can tell a new commit from a no-op round.
  const res = await sandbox.commands.run(
    'git add -A; if git diff --cached --quiet; then echo NOCHANGE; else git commit -q -m "round" && git rev-parse HEAD; fi',
    { cwd: WORKDIR },
  );
  const hash = res.stdout.trim();
  if (hash === "NOCHANGE" || hash === "") return { kind: "nochange" };

  const bundlePath = `/tmp/${hash}.bundle`;
  try {
    const size = await sandbox.commands.run(`git bundle create ${bundlePath} HEAD && stat -c %s ${bundlePath}`, { cwd: WORKDIR });
    const out = size.stdout.trim();
    if (!/^\d+$/.test(out)) throw new Error(`bundle size unreadable: ${JSON.stringify(out)}`);
    const bytes = Number(out);
    if (bytes > maxBytes) return { kind: "oversize", hash, bytes };
    const bundle = await sandbox.files.read(bundlePath, { format: "bytes" });
    return { kind: "bundle", hash, bundle };
  } finally {
    await sandbox.commands.run(`rm -f ${bundlePath}`).catch(() => {});
  }
}

// Appended to the round's last tool result so the model sees it on its next call (and it's
// persisted with the round). Without it the agent keeps growing the repo and every later
// round is silently unsaved.
export function oversizeNote(bytes: number, maxBytes = SNAPSHOT_MAX_BYTES): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `[orin] The workspace snapshot is ${mb(bytes)}, over the ${mb(maxBytes)} limit, so this work is NOT being saved. Remove large files (build output, binaries, big assets) or add them to .gitignore.`;
}
