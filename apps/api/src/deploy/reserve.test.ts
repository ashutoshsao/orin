import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, project, user } from "@repo/db";
import { releaseVercelProject, reserveVercelProject } from "./reserve";

// Against the local Postgres (`docker compose up -d`): the guarantee under test is the unique
// constraint, so a fake DB would prove nothing.
const USER_ID = `test-reserve-${crypto.randomUUID()}`;
const NAME = `coffee-shop-${crypto.randomUUID().slice(0, 8)}`;
let a = "";
let b = "";

beforeAll(async () => {
  await db.insert(user).values({ id: USER_ID, name: "reserve test", email: `${USER_ID}@orin.test` });
  [{ id: a }, { id: b }] = await db.insert(project).values([{ userId: USER_ID, name: "A" }, { userId: USER_ID, name: "B" }]).returning({ id: project.id }) as [{ id: string }, { id: string }];
});
afterAll(async () => {
  await db.delete(user).where(eq(user.id, USER_ID)); // cascades the projects
});
const nameOf = async (id: string) => (await db.select({ n: project.vercelProject }).from(project).where(eq(project.id, id)))[0]?.n;

describe("reserveVercelProject", () => {
  test("two projects racing for one name: exactly one gets it", async () => {
    const results = await Promise.all([reserveVercelProject(a, NAME), reserveVercelProject(b, NAME)]);
    expect(results.sort()).toEqual(["reserved", "taken"]);
    const holders = [await nameOf(a), await nameOf(b)].filter((n) => n === NAME);
    expect(holders).toHaveLength(1);
  });

  test("a project keeps its name: asking again for it is fine, for another is refused", async () => {
    const winner = (await nameOf(a)) === NAME ? a : b;
    expect(await reserveVercelProject(winner, NAME)).toBe("reserved");
    expect(await reserveVercelProject(winner, `${NAME}-other`)).toBe("taken");
  });

  test("release frees an unused name, but never one that's been deployed", async () => {
    const winner = (await nameOf(a)) === NAME ? a : b;
    await db.update(project).set({ deployUrl: "https://x.vercel.app" }).where(eq(project.id, winner));
    await releaseVercelProject(winner, NAME);
    expect(await nameOf(winner)).toBe(NAME); // deployed → kept

    await db.update(project).set({ deployUrl: null }).where(eq(project.id, winner));
    await releaseVercelProject(winner, NAME);
    expect(await nameOf(winner)).toBeNull();
  });
});
