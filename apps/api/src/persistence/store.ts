import { db, message, project } from "@repo/db";
import { and, asc, eq, gte } from "drizzle-orm";
import type { ContextType, MessageType } from "../agent/types";
import { r2, snapshotKey } from "./r2";

// A message row = one MessageType: role + jsonb content (string for user/system,
// ToolCallsType for an assistant tool call, ToolResultType[] for a tool result).
// jsonb round-trips all of those, so persist/load is a straight map.

// Project-scoped persister injected into AgentSession. `startSeq` is the index in
// the context array of the first message in `messages`, so seq mirrors array order.
export function messagePersister(projectId: string) {
  return async (messages: MessageType[], startSeq: number) => {
    if (messages.length === 0) return;
    await db.insert(message).values(
      messages.map((m, i) => ({
        projectId,
        seq: startSeq + i,
        role: m.role,
        content: m.content as unknown, // jsonb
      })),
    );
  };
}

// Project-scoped snapshot persister injected into AgentSession. Uploads a git bundle
// (built + read out of the sandbox) to R2 and points `latestSnapshotKey` at it — the
// object a fresh sandbox restores from. Synchronous for now; a Redis queue makes it
// non-blocking later. It deliberately does NOT touch durableCodebaseN — that advances
// only once context is ALSO persisted (see durablePersister), so the clamp marker never
// claims a round whose context isn't durable.
export function snapshotPersister(projectId: string, userId: string) {
  return async (bundle: Uint8Array, commitHash: string) => {
    const key = snapshotKey(userId, projectId, commitHash);
    await r2.write(key, bundle);
    await db
      .update(project)
      .set({ latestSnapshotKey: key, updatedAt: new Date() })
      .where(eq(project.id, projectId));
  };
}

// Advance the "durable up to N" marker: how many context messages are consistent with
// the durable codebase. Called after context flush, only when the sandbox's HEAD equals
// the last pushed commit — so on sandbox-death restore, replayed context never runs
// ahead of the restorable codebase.
export function durablePersister(projectId: string) {
  return async (n: number) => {
    await db.update(project).set({ durableCodebaseN: n }).where(eq(project.id, projectId));
  };
}

// Fetch the latest codebase bundle for a project from R2, or null if it has none
// (new project, or nothing pushed yet). Injected into AgentSession to rehydrate the
// sandbox's files on resume. Returns raw bundle bytes; the session unpacks them.
export function snapshotLoader(projectId: string) {
  return async (): Promise<Uint8Array | null> => {
    const [row] = await db
      .select({ key: project.latestSnapshotKey })
      .from(project)
      .where(eq(project.id, projectId));
    if (!row?.key) return null;
    return await r2.file(row.key).bytes();
  };
}

// Load a project's conversation back into a ContextType for resume, clamped to the
// durable-up-to-N marker. If the codebase in R2 lagged context when the sandbox died,
// rows past N describe rounds whose files can't be restored — so we DELETE them (the
// agent re-does them) and load only seq < N. This keeps context, the message log, and
// the restored codebase aligned, and prevents seq collisions when new rounds append.
// durableCodebaseN is normally the full length (clean close), so nothing is dropped.
export async function loadContext(projectId: string): Promise<ContextType> {
  const [proj] = await db
    .select({ n: project.durableCodebaseN })
    .from(project)
    .where(eq(project.id, projectId));
  const n = proj?.n ?? null;
  if (n !== null) {
    await db.delete(message).where(and(eq(message.projectId, projectId), gte(message.seq, n)));
  }
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.projectId, projectId))
    .orderBy(asc(message.seq));
  return rows.map((r) => ({ role: r.role, content: r.content }) as MessageType);
}
