import { and, eq, isNull } from "drizzle-orm";
import { db, project } from "@repo/db";

// Claim a Vercel project name for an Orin project BEFORE its first deploy. Saving the name only
// after a successful deploy (the first version) is check-then-insert: two projects that pick
// the same slug and happen to share their 4 id characters would both pass, and the second would
// deploy into the first one's Vercel project — replacing someone else's app. The unique
// constraint on project.vercel_project makes the claim atomic: one writer wins, the other gets
// "taken", however close together they click.
export async function reserveVercelProject(projectId: string, name: string): Promise<"reserved" | "taken"> {
  try {
    const won = await db
      .update(project)
      .set({ vercelProject: name })
      .where(and(eq(project.id, projectId), isNull(project.vercelProject)))
      .returning({ id: project.id });
    if (won.length) return "reserved";
  } catch (e) {
    // Rather than decode driver error codes: if someone else now holds the name, that's what
    // the write ran into. Anything else is a real failure.
    const holder = await holderOf(name);
    if (holder && holder !== projectId) return "taken";
    throw e;
  }
  // Nothing updated: this project already has a name. Only "reserved" if it's this one.
  const [row] = await db.select({ name: project.vercelProject }).from(project).where(eq(project.id, projectId));
  return row?.name === name ? "reserved" : "taken";
}

// Undo a reservation that can't be used (the name exists on Vercel outside Orin). Conditional,
// so it can never clear a name this project went on to deploy under.
export async function releaseVercelProject(projectId: string, name: string): Promise<void> {
  await db
    .update(project)
    .set({ vercelProject: null })
    .where(and(eq(project.id, projectId), eq(project.vercelProject, name), isNull(project.deployUrl)));
}

async function holderOf(name: string): Promise<string | undefined> {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.vercelProject, name));
  return row?.id;
}
