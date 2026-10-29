-- NFR-06: break-glass access to a locked vault requires two different people (requester and approver)
-- and is always time-limited.
CREATE TABLE IF NOT EXISTS "break_glass_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"requester_id" varchar(255) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"approver_id" varchar(255),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "break_glass_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'revoked')),
	CONSTRAINT "break_glass_dual_control" CHECK ("approver_id" IS NULL OR lower("approver_id") <> lower("requester_id"))
);
--> statement-breakpoint
ALTER TABLE "break_glass_requests" ADD CONSTRAINT "break_glass_vault_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_break_glass_vault" ON "break_glass_requests" USING btree ("vault_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_break_glass_requester" ON "break_glass_requests" USING btree ("requester_id");
