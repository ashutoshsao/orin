import { expect, test } from "bun:test";
import { bundlesToDelete } from "./retention";

const at = (key: string, minute: number) => ({ key, lastModified: new Date(Date.UTC(2026, 8, 17, 10, minute)) });

test("keeps the latest + one newest spare, deletes the rest", () => {
  const objs = [at("a", 1), at("b", 2), at("c", 3), at("d", 4)];
  expect(bundlesToDelete(objs, "d").sort()).toEqual(["a", "b"]);
});

test("latest is kept even when it isn't the newest object (e.g. a stale upload landed after it)", () => {
  const objs = [at("a", 1), at("latest", 2), at("stale", 3)];
  expect(bundlesToDelete(objs, "latest")).toEqual(["a"]);
});

test("two or fewer objects → nothing deleted", () => {
  expect(bundlesToDelete([at("a", 1), at("b", 2)], "b")).toEqual([]);
  expect(bundlesToDelete([at("b", 2)], "b")).toEqual([]);
});

test("latest missing from the listing → keep the newest `keep` objects", () => {
  expect(bundlesToDelete([at("a", 1), at("b", 2), at("c", 3)], "gone").sort()).toEqual(["a"]);
});
