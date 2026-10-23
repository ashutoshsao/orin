ALTER TABLE "project" ADD COLUMN "deploy_url" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deployed_commit" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deployed_at" timestamp with time zone;