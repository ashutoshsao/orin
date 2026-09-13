import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accountAccess, db, message, project, user } from "@repo/db";
import { clearKey, hasKey, keyInfo, providerForUser, setKey, validateKey } from "./byok";
import type { LLMProvider } from "../agent/types";

const USER = `test-byok-${crypto.randomUUID()}`;
const SECRET = "sk-super-secret-key-value-1234";

const fakeProvider = (res: Awaited<ReturnType<LLMProvider["callLLM"]>>): LLMProvider => ({ callLLM: async () => res });

afterEach(() => clearKey(USER));

describe("BYOK key store", () => {
  test("a stored key builds a provider but is never handed back", () => {
    setKey(USER, { provider: "deepseek", apiKey: SECRET });
    expect(hasKey(USER)).toBe(true);
    expect(providerForUser(USER)).toHaveProperty("callLLM");
    // Only the provider name comes back — the key itself has no getter.
    expect(keyInfo(USER)).toEqual({ provider: "deepseek", model: undefined });
    expect(JSON.stringify(keyInfo(USER))).not.toContain(SECRET);
  });

  test("clearing it means the visitor is asked again", () => {
    setKey(USER, { provider: "deepseek", apiKey: SECRET });
    clearKey(USER);
    expect(hasKey(USER)).toBe(false);
    expect(providerForUser(USER)).toBeNull();
  });

  test("the key is not written to the database", async () => {
    setKey(USER, { provider: "deepseek", apiKey: SECRET });
    await db.insert(user).values({ id: USER, name: "byok test", email: `${USER}@orin.test` });
    await db.insert(accountAccess).values({ userId: USER, tier: "byok", stepsLimit: 60 });
    const [p] = await db.insert(project).values({ userId: USER, name: "byok test" }).returning();
    await db.insert(message).values({ projectId: p.id, seq: 0, role: "user", content: "build a todo app" });

    // Everything this account owns, as JSON — the key must appear nowhere in it.
    const dump = JSON.stringify([
      await db.select().from(user).where(eq(user.id, USER)),
      await db.select().from(accountAccess).where(eq(accountAccess.userId, USER)),
      await db.select().from(project).where(eq(project.userId, USER)),
      await db.select().from(message).where(eq(message.projectId, p.id)),
    ]);
    expect(dump).not.toContain(SECRET);
    await db.delete(user).where(eq(user.id, USER));
  });
});

describe("validateKey", () => {
  test("a working key is accepted", async () => {
    const res = await validateKey({ provider: "deepseek", apiKey: SECRET }, () => fakeProvider({ status: "done", content: "ok" }));
    expect(res).toEqual({ ok: true });
  });

  test("a rejected key fails with the provider's own wording, before anything is stored", async () => {
    const res = await validateKey({ provider: "deepseek", apiKey: "bad" }, () => fakeProvider({ status: "error", content: "401 Incorrect API key" }));
    expect(res).toMatchObject({ ok: false, message: "401 Incorrect API key" });
    expect(hasKey(USER)).toBe(false);
  });

  test("a provider with no default model asks for one instead of guessing", async () => {
    const res = await validateKey({ provider: "openai", apiKey: SECRET });
    expect(res).toMatchObject({ ok: false });
    if (res.ok) return;
    expect(res.message).toContain("model name is required");
  });
});
