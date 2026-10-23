import { expect, test } from "bun:test";
import { VercelClient } from "./vercel";
import { acquireDeployment } from "./operation";

function fixture(responses: [number, unknown][]) {
  const calls: { method: string; url: string }[] = [];
  const client = new VercelClient({ token: "test", teamId: "team-test", fetch: (async (url, init) => {
    calls.push({ method: init?.method ?? "GET", url: String(url) });
    const [status, body] = responses.shift()!;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch });
  return { client, calls };
}

test("deletes only the verified immutable Vercel project ID", async () => {
  const f = fixture([[200, { id: "prj_123" }], [200, { deployments: [{ meta: { orinProjectId: "ours" } }] }], [204, null]]);
  await f.client.unpublish("coffee-abcd", "ours");
  expect(f.calls.at(-1)).toEqual({ method: "DELETE", url: "https://api.vercel.com/v9/projects/prj_123?teamId=team-test" });
});
test("refuses deletion when metadata belongs to another Orin project", async () => {
  const f = fixture([[200, { id: "prj_123" }], [200, { deployments: [{ meta: { orinProjectId: "other" } }] }]]);
  await expect(f.client.unpublish("coffee-abcd", "ours")).rejects.toThrow("ownership");
  expect(f.calls.some(c => c.method === "DELETE")).toBe(false);
});
test("an already deleted project can be retried", async () => {
  const f = fixture([[404, { error: { code: "not_found" } }]]);
  await f.client.unpublish("coffee-abcd", "ours");
  expect(f.calls).toHaveLength(1);
});
test("provider failures propagate instead of clearing deployment state", async () => {
  const f = fixture([[200, { id: "prj_123" }], [200, { deployments: [{ meta: { orinProjectId: "ours" } }] }], [403, { error: { message: "Forbidden" } }]]);
  await expect(f.client.unpublish("coffee-abcd", "ours")).rejects.toThrow("Forbidden");
});
test("publish and unpublish cannot overlap, independent of sandbox lifetime", () => {
  const release = acquireDeployment("project");
  expect(release).not.toBeNull();
  expect(acquireDeployment("project")).toBeNull();
  release!();
  const next = acquireDeployment("project");
  expect(next).not.toBeNull();
  next!();
});
