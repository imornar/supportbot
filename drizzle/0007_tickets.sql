CREATE TYPE "public"."ticket_message_visibility" AS ENUM('customer', 'internal');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed');--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"visibility" "ticket_message_visibility" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_messages_body_length" CHECK (char_length("ticket_messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"priority" "ticket_priority" NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"source_message_id" uuid,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "tickets_reason" CHECK ("tickets"."reason" in ('customer_requested_human', 'insufficient_evidence', 'conflicting_sources', 'repeated_attempts', 'sensitive_request', 'business_tool_unavailable', 'workflow_failure')),
	CONSTRAINT "tickets_priority_matches_reason" CHECK ((
        "tickets"."reason" in ('sensitive_request', 'conflicting_sources', 'workflow_failure')
        and "tickets"."priority" = 'high'
      ) or (
        "tickets"."reason" in ('customer_requested_human', 'business_tool_unavailable', 'repeated_attempts')
        and "tickets"."priority" = 'normal'
      ) or (
        "tickets"."reason" = 'insufficient_evidence' and "tickets"."priority" = 'low'
      )),
	CONSTRAINT "tickets_citations_array" CHECK (jsonb_typeof("tickets"."citations") = 'array' and jsonb_array_length("tickets"."citations") <= 20),
	CONSTRAINT "tickets_status_timestamps" CHECK ((
        "tickets"."status" = 'open'
        and "tickets"."assignee_user_id" is null
        and "tickets"."claimed_at" is null
        and "tickets"."resolved_at" is null
      ) or (
        "tickets"."status" = 'assigned'
        and "tickets"."assignee_user_id" is not null
        and "tickets"."claimed_at" is not null
        and "tickets"."resolved_at" is null
      ) or (
        "tickets"."status" = 'in_progress'
        and "tickets"."assignee_user_id" is not null
        and "tickets"."claimed_at" is not null
        and "tickets"."resolved_at" is null
      ) or (
        "tickets"."status" = 'resolved'
        and "tickets"."assignee_user_id" is not null
        and "tickets"."claimed_at" is not null
        and "tickets"."resolved_at" is not null
      ) or (
        "tickets"."status" = 'reopened'
        and "tickets"."assignee_user_id" is null
        and "tickets"."claimed_at" is null
        and "tickets"."resolved_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "support_submissions" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_tenant_fk" FOREIGN KEY ("ticket_id","tenant_id") REFERENCES "public"."tickets"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_customer_fk" FOREIGN KEY ("conversation_id","tenant_id","requester_user_id") REFERENCES "public"."conversations"("id","tenant_id","customer_user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_source_message_fk" FOREIGN KEY ("source_message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_created_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_active_reason_unique" ON "tickets" USING btree ("tenant_id","conversation_id","reason") WHERE "tickets"."status" in ('open', 'assigned', 'in_progress', 'reopened');--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_source_message_unique" ON "tickets" USING btree ("source_message_id") WHERE "tickets"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_tenant_status_updated_idx" ON "tickets" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "tickets_tenant_requester_idx" ON "tickets" USING btree ("tenant_id","requester_user_id");--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_ticket_tenant_fk" FOREIGN KEY ("ticket_id","tenant_id") REFERENCES "public"."tickets"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;