import { db, message } from "@repo/db";
import { asc, eq } from "drizzle-orm";
import type { ContextType, MessageType } from "../agent/types";

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

// Load a project's conversation back into a ContextType for resume.
export async function loadContext(projectId: string): Promise<ContextType> {
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.projectId, projectId))
    .orderBy(asc(message.seq));
  return rows.map((r) => ({ role: r.role, content: r.content }) as MessageType);
}
