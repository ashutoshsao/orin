import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// `user` is owned by Better Auth (auth-schema.ts, CLI-generated). Our tables FK to it.

// Invite gate: only emails present here may create an account.
export const allowlist = pgTable("allowlist", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One app being built, owned by a user.
export const project = pgTable("project", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  name: text("name").notNull(),
  latestSnapshotKey: text("latest_snapshot_key"), // R2 key for codebase restore (M5b)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Durable conversation log — one polymorphic table (role column), tool call/result
// are rows with the tool name inside `content`. Source of truth for resume.
export const message = pgTable("message", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => project.id),
  seq: integer("seq").notNull(), // ordering within a project
  role: text("role").notNull(), // system | user | assistant | tool
  content: jsonb("content").notNull(), // preserves tool_calls / tool results structure
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
