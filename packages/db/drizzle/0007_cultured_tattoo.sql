CREATE TABLE "account_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"steps_limit" integer,
	"steps_used" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_access_steps_within_limit" CHECK ("account_access"."steps_limit" IS NULL OR "account_access"."steps_used" <= "account_access"."steps_limit")
);
--> statement-breakpoint
ALTER TABLE "account_access" ADD CONSTRAINT "account_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill (7a): every existing user got in through the allowlist gate → unlimited, never expires.
INSERT INTO "account_access" ("user_id", "tier") SELECT "id", 'allowlist' FROM "user" ON CONFLICT DO NOTHING;
