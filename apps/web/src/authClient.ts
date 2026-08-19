import { createAuthClient } from "better-auth/react";

// Points at the API server; the client sends/stores the session cookie cross-origin.
export const authClient = createAuthClient({
  baseURL: "http://localhost:4000",
});
