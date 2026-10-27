ALTER TABLE "account_access" ADD COLUMN "data_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_access" ADD COLUMN "extension_requested_at" timestamp with time zone;