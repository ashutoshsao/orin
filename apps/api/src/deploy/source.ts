import type { SnapshotSandbox } from "../agent/snapshot";
import { WORKDIR } from "../agent/tools";

// Same ceiling as a snapshot bundle, for the same reason: `files.read` loads the whole file
// into API memory, so the size is measured inside the sandbox before anything is read out.
export const SOURCE_MAX_BYTES = 25 * 1024 * 1024;

export type SourceFile = { path: string; bytes: Uint8Array };
export type Source = { commit: string; files: SourceFile[] };

export class SourceTooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`source is ${bytes} bytes, over the ${SOURCE_MAX_BYTES} byte limit`);
  }
}

// The app's source as of its last round commit. `git archive` gives exactly the committed
// tree — no node_modules, no dist, nothing .gitignore'd — in one file, so it's one read out
// of the sandbox instead of one per file. HEAD is what the last snapshot saved, so a deploy
// always matches a restorable rewind point.
export async function exportSource(sandbox: SnapshotSandbox, maxBytes = SOURCE_MAX_BYTES): Promise<Source> {
  const tarPath = `/tmp/orin-deploy-${crypto.randomUUID()}.tar`;
  try {
    const res = await sandbox.commands.run(
      `git rev-parse HEAD && git archive --format=tar -o ${tarPath} HEAD && stat -c %s ${tarPath}`,
      { cwd: WORKDIR },
    );
    const [commit, size] = res.stdout.trim().split("\n");
    if (!commit || !/^[0-9a-f]{40}$/.test(commit) || !size || !/^\d+$/.test(size)) {
      throw new Error(`source export unreadable: ${JSON.stringify(res.stdout)}`);
    }
    if (Number(size) > maxBytes) throw new SourceTooLarge(Number(size));
    const tar = await sandbox.files.read(tarPath, { format: "bytes" });
    return { commit, files: parseTar(tar) };
  } finally {
    await sandbox.commands.run(`rm -f ${tarPath}`).catch(() => {});
  }
}

// Regular files from a ustar archive, as `git archive` writes it. Only what that output
// contains is handled: a pax global header (the commit id), pax extended headers (paths over
// 100 characters), directories and files. Symlinks and other entries are skipped.
export function parseTar(buf: Uint8Array): SourceFile[] {
  const dec = new TextDecoder();
  const field = (at: number, len: number) => {
    const s = dec.decode(buf.subarray(at, at + len));
    const end = s.indexOf("\0");
    return end === -1 ? s : s.slice(0, end);
  };
  const files: SourceFile[] = [];
  let paxPath: string | undefined;
  let off = 0;
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break; // end-of-archive block
    const name = field(off, 100);
    const size = parseInt(field(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(buf[off + 156]!);
    const prefix = field(off + 345, 155);
    const data = buf.subarray(off + 512, off + 512 + size);
    if (type === "x") {
      paxPath = paxRecord(dec.decode(data), "path");
    } else {
      if (type === "0" || type === "\0") {
        files.push({ path: paxPath ?? (prefix ? `${prefix}/${name}` : name), bytes: data.slice() });
      }
      paxPath = undefined; // an extended header applies to the next entry only
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

// pax records are "<length> <key>=<value>\n", back to back.
function paxRecord(text: string, key: string): string | undefined {
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    const sp = line.indexOf(" ");
    if (sp !== -1 && eq > sp && line.slice(sp + 1, eq) === key) return line.slice(eq + 1);
  }
  return undefined;
}
