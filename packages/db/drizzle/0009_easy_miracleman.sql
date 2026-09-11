CREATE TABLE "invite" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
