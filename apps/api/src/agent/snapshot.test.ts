import { describe, expect, test } from "bun:test";
import { oversizeNote, snapshotRound, type SnapshotSandbox } from "./snapshot";

// A fake sandbox that answers the three shell steps (commit, bundle+stat, rm) and records
// every command and read, so tests can assert what did — and didn't — happen.
function fakeSandbox(opts: { commit: string; bundleBytes?: string; bundleFails?: boolean }) {
  const commands: string[] = [];
  const reads: string[] = [];
  const sandbox: SnapshotSandbox = {
    commands: {
      run: (async (cmd: string) => {
        commands.push(cmd);
        if (cmd.startsWith("git add -A")) return { stdout: opts.commit, stderr: "", exitCode: 0 };
        if (cmd.startsWith("git bundle create")) {
          if (opts.bundleFails) throw new Error("exit 128");
          return { stdout: `${opts.bundleBytes}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }) as SnapshotSandbox["commands"]["run"],
    },
    files: {
      read: (async (path: string) => {
        reads.push(path);
        return new Uint8Array([1, 2, 3]);
      }) as SnapshotSandbox["files"]["read"],
    },
  };
  return { sandbox, commands, reads };
}

const HASH = "a".repeat(40);
const removed = (commands: string[]) => commands.some((c) => c === `rm -f /tmp/${HASH}.bundle`);

describe("snapshotRound", () => {
  test("no change → no bundle built", async () => {
    const f = fakeSandbox({ commit: "NOCHANGE\n" });
    expect(await snapshotRound(f.sandbox)).toEqual({ kind: "nochange" });
    expect(f.commands).toHaveLength(1);
    expect(f.reads).toHaveLength(0);
  });

  test("under the cap → bundle read out, then removed from the sandbox", async () => {
    const f = fakeSandbox({ commit: HASH, bundleBytes: "61234" });
    const res = await snapshotRound(f.sandbox, 1000_000);
    expect(res).toEqual({ kind: "bundle", hash: HASH, bundle: new Uint8Array([1, 2, 3]) });
    expect(f.reads).toEqual([`/tmp/${HASH}.bundle`]);
    expect(removed(f.commands)).toBe(true);
  });

  test("over the cap → never read, still removed", async () => {
    const f = fakeSandbox({ commit: HASH, bundleBytes: String(3 * 1024 ** 3) });
    const res = await snapshotRound(f.sandbox, 25 * 1024 * 1024);
    expect(res).toEqual({ kind: "oversize", hash: HASH, bytes: 3 * 1024 ** 3 });
    expect(f.reads).toHaveLength(0);
    expect(removed(f.commands)).toBe(true);
  });

  test("exactly at the cap is allowed", async () => {
    const f = fakeSandbox({ commit: HASH, bundleBytes: "100" });
    expect((await snapshotRound(f.sandbox, 100)).kind).toBe("bundle");
  });

  test("unreadable size → throws without reading, removes the partial bundle", async () => {
    const f = fakeSandbox({ commit: HASH, bundleBytes: "" });
    await expect(snapshotRound(f.sandbox)).rejects.toThrow("bundle size unreadable");
    expect(f.reads).toHaveLength(0);
    expect(removed(f.commands)).toBe(true);
  });

  test("bundle command fails → throws, removes the partial bundle", async () => {
    const f = fakeSandbox({ commit: HASH, bundleFails: true });
    await expect(snapshotRound(f.sandbox)).rejects.toThrow("exit 128");
    expect(f.reads).toHaveLength(0);
    expect(removed(f.commands)).toBe(true);
  });
});

test("oversizeNote names the size and the limit", () => {
  expect(oversizeNote(1.5 * 1024 ** 3, 25 * 1024 * 1024)).toContain("1536.0 MB, over the 25.0 MB limit");
});
