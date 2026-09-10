import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accountAccess, db, message, project, snapshot, user } from "./index";

// Runs against the local Postgres. Deleting a user must take everything they own with it
// (7d prune is a single DELETE) — before 0008 it failed on the project FK instead.
test("deleting a user cascades to access, projects, messages and snapshots", async () => {
  const id = `test-cascade-${crypto.randomUUID()}`;
  await db.insert(user).values({ id, name: "cascade", email: `${id}@orin.test` });
  await db.insert(accountAccess).values({ userId: id, tier: "guest", stepsLimit: 60 });
  const [p] = await db.insert(project).values({ userId: id, name: "cascade" }).returning();
  await db.insert(message).values({ projectId: p.id, seq: 0, role: "user", content: "hi" });
  await db.insert(snapshot).values({ projectId: p.id, commitHash: "a".repeat(40), n: 1, key: "k" });

  await db.delete(user).where(eq(user.id, id));

  expect(await db.select().from(accountAccess).where(eq(accountAccess.userId, id))).toHaveLength(0);
  expect(await db.select().from(project).where(eq(project.id, p.id))).toHaveLength(0);
  expect(await db.select().from(message).where(eq(message.projectId, p.id))).toHaveLength(0);
  expect(await db.select().from(snapshot).where(eq(snapshot.projectId, p.id))).toHaveLength(0);
});
