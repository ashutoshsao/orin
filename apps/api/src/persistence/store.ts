import { db, message, project } from "@repo/db";
import { and, asc, eq, gte } from "drizzle-orm";
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
