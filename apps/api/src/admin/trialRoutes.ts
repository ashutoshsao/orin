import { Elysia } from "elysia";
import { extendTrial, requestTrialExtension } from "./trialExtensions";

type TrialAuth = {
  getUserId: (request: Request) => Promise<string | null>;
  requireAdmin: (request: Request) => Promise<{ ok: true } | { ok: false; status: 401 | 403 }>;
};

// Separate from server startup so permission tests never run the E2B orphan sweep.
export function trialRoutes(auth: TrialAuth) {
  return new Elysia()
    .post("/access-request", async ({ request, set }) => {
      // Authentication only: expired users must be able to request an extension.
      const userId = await auth.getUserId(request);
      if (!userId) { set.status = 401; return { error: "unauthorized" }; }
      const requestedAt = await requestTrialExtension(userId);
      if (!requestedAt) { set.status = 409; return { error: "trial_not_ended" }; }
      return { ok: true, requestedAt };
    })
    .post("/admin/users/:id/extend-trial", async ({ request, params, set }) => {
      const who = await auth.requireAdmin(request);
      if (!who.ok) { set.status = who.status; return { error: "forbidden" }; }
      const result = await extendTrial(params.id);
      if (!result) { set.status = 404; return { error: "trial_not_found" }; }
      return { ok: true, ...result };
    });
}
