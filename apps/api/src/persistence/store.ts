import { db, message, project, snapshot } from "@repo/db";
import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import type { ContextType, MessageType } from "../agent/types";
import { r2 } from "./r2";

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

// The R2 push + latestSnapshotKey/durableCodebaseN updates now live in the background
// worker (snapshotQueue.ts), off the agent's hot path.

// What to rehydrate a sandbox from: the newest bundle, and the commit to land on. Injected
// into AgentSession; null for a project with nothing pushed yet.
export type RestorePoint = { bundle: Uint8Array; commit: string | null };

// The bundle is always the NEWEST one (`latestSnapshotKey`; rewind leaves it alone), and the
// commit is the highest-n snapshot row's — normally that bundle's HEAD, but after a rewind
// the rewind target, which the newest bundle still contains (every kept row is an ancestor
// of it). This is what lets older bundles be pruned without breaking rewind (7.1).
export function snapshotLoader(projectId: string) {
  return async (): Promise<RestorePoint | null> => {
    const [row] = await db
      .select({ key: project.latestSnapshotKey })
      .from(project)
      .where(eq(project.id, projectId));
    if (!row?.key) return null;
    const [target] = await db
      .select({ commit: snapshot.commitHash })
      .from(snapshot)
      .where(eq(snapshot.projectId, projectId))
      .orderBy(desc(snapshot.n))
      .limit(1);
    return { bundle: await r2.file(row.key).bytes(), commit: target?.commit ?? null };
  };
}

// Rewind a project to the snapshot covering `n` messages: drop later messages and rewind
// points. latestSnapshotKey is left alone — the newest bundle contains the target commit,
// and restore resets to the highest-n row, which after the delete is the target (7.1).
// Bumping rewindGen first takes the project row lock, so an in-flight worker push either
// commits before (its row is then deleted here) or sees the new gen and drops itself.
// The caller closes the live session first.
export async function rewindProject(projectId: string, n: number) {
  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ durableCodebaseN: n, rewindGen: sql`${project.rewindGen} + 1`, updatedAt: new Date() })
      .where(eq(project.id, projectId));
    await tx.delete(message).where(and(eq(message.projectId, projectId), gte(message.seq, n)));
    await tx.delete(snapshot).where(and(eq(snapshot.projectId, projectId), gt(snapshot.n, n)));
  });
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
