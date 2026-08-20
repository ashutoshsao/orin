import { db, message, project } from "@repo/db";
import { asc, eq } from "drizzle-orm";
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
// (built + read out of the sandbox by the session) to R2, then advances the project's
// pointer: the R2 key to restore from, and `durableN` = how many context messages this
// snapshot covers (the durable-up-to-N clamp marker). Synchronous for now — the Redis
// queue that makes this non-blocking is a later step.
export function snapshotPersister(projectId: string, userId: string) {
  return async (bundle: Uint8Array, commitHash: string, durableN: number) => {
    const key = snapshotKey(userId, projectId, commitHash);
    await r2.write(key, bundle);
    await db
      .update(project)
      .set({ latestSnapshotKey: key, durableCodebaseN: durableN, updatedAt: new Date() })
      .where(eq(project.id, projectId));
  };
}

// Load a project's conversation back into a ContextType for resume.
export async function loadContext(projectId: string): Promise<ContextType> {
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.projectId, projectId))
    .orderBy(asc(message.seq));
  return rows.map((r) => ({ role: r.role, content: r.content }) as MessageType);
}
