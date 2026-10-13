-- FR-52: SSO group membership observed at sign-in, used to resolve vault shares granted to a group.
CREATE TABLE IF NOT EXISTS "user_groups" (
	"user_id" varchar(255) NOT NULL,
	"group_id" varchar(255) NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_groups_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_groups_user" ON "user_groups" USING btree ("user_id");
