ALTER TABLE "allowlist" DROP CONSTRAINT "allowlist_invited_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "snapshot" DROP CONSTRAINT "snapshot_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "allowlist" ADD CONSTRAINT "allowlist_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;