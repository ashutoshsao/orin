import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One pushed codebase snapshot = a rewind point. Written by the snapshot worker per
// push (M5b): `commitHash` is the git commit, `n` the context length it covers, `key`
// the R2 bundle. Rewinding to a snapshot restores its bundle and truncates context to n.
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
export const message = pgTable("message", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => project.id),
  seq: integer("seq").notNull(), // ordering within a project
  role: text("role").notNull(), // system | user | assistant | tool
  content: jsonb("content").notNull(), // preserves tool_calls / tool results structure
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
