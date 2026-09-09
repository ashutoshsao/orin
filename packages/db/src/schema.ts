import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// `user` is owned by Better Auth (auth-schema.ts, CLI-generated). Our tables FK to it.

// Every timestamp is `timestamptz` (withTimezone), never plain `timestamp`: Bun's Postgres
// driver decodes a plain `timestamp` on the parameterised path (any query with a WHERE)
// by applying the process's local offset, so reads came back shifted (+5:30 in IST).
// timestamptz is unambiguous and reads correctly on every path. Verified, not assumed.

// Invite gate: only emails present here may create an account.
export const allowlist = pgTable("allowlist", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// What a user may spend (7a). One row per user; the tier comes from the allowlist, never
// from the sign-in method. `stepsLimit` null = unlimited; a step is one successful LLM call.
// `expiresAt` null = never — access expires automatically, data is only deleted by prune (7d).
export const ACCESS_TIERS = ["allowlist", "guest", "byok"] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

export const accountAccess = pgTable(
  "account_access",
  {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    tier: text("tier", { enum: ACCESS_TIERS }).notNull(),
    stepsLimit: integer("steps_limit"),
    stepsUsed: integer("steps_used").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // The reserve UPDATE's `steps_used < steps_limit` guard already stops overspend; this makes
  // any other writer that would push past the limit fail loudly instead.
  (t) => [check("account_access_steps_within_limit", sql`${t.stepsLimit} IS NULL OR ${t.stepsUsed} <= ${t.stepsLimit}`)],
);

// One app being built, owned by a user.
export const project = pgTable("project", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  name: text("name").notNull(),
  latestSnapshotKey: text("latest_snapshot_key"), // R2 key for codebase restore (M5b)
  // How many context messages the latest pushed snapshot covers — the "durable up to N"
  // marker. On sandbox-death restore, context is clamped to this so replayed history
  // never runs ahead of the restorable codebase (M5b step 5).
  durableCodebaseN: integer("durable_codebase_n"),
  // Bumped by every rewind. Snapshot jobs carry the value their session started with; the
  // worker drops any job whose generation is stale, so a push queued before a rewind can't
  // land after it (re-adding a row past the rewind point / moving latestSnapshotKey).
  rewindGen: integer("rewind_gen").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One pushed codebase snapshot = a rewind point. Written by the snapshot worker per
// push (M5b): `commitHash` is the git commit, `n` the context length it covers, `key`
// the R2 bundle it was pushed in. Rewind no longer restores `key` (older bundles are pruned,
// 7.1): every kept row's commit is in the newest bundle, so restore fetches that and resets
// to the highest-n row's commit. `key` is kept as a record, not relied on.
export const snapshot = pgTable("snapshot", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => project.id),
  commitHash: text("commit_hash").notNull(),
  n: integer("n").notNull(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Durable conversation log — one polymorphic table (role column), tool call/result
// are rows with the tool name inside `content`. Source of truth for resume.
export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id").notNull().references(() => project.id),
    seq: integer("seq").notNull(), // ordering within a project
    role: text("role").notNull(), // system | user | assistant | tool
    content: jsonb("content").notNull(), // preserves tool_calls / tool results structure
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // One row per position in a conversation. Without this, a stale session's late write
  // silently interleaved with the live session's rows at the same seq (corrupting the
  // tool_calls → results order); now it fails loudly instead.
  (t) => [uniqueIndex("message_project_seq_unique").on(t.projectId, t.seq)],
);
