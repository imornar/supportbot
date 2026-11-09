CREATE TYPE "public"."citation_validation" AS ENUM('passed', 'failed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."message_outcome" AS ENUM('answered', 'abstained');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'complete');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"is_private" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "conversations_id_tenant_customer_unique" UNIQUE("id","tenant_id","customer_user_id"),
	CONSTRAINT "conversations_private_owner" CHECK ((
        "conversations"."is_private" = true and "conversations"."customer_user_id" is not null
      ) or (
        "conversations"."is_private" = false and "conversations"."customer_user_id" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"body" text NOT NULL,
	"outcome" "message_outcome",
	"citation_validation" "citation_validation",
	"model_id" text,
	"answer_reason" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") between 1 and 4000),
	CONSTRAINT "messages_model_id_shape" CHECK ("messages"."model_id" is null or "messages"."model_id" ~ '^[A-Za-z0-9._:-]{1,64}$'),
	CONSTRAINT "messages_answer_reason" CHECK ("messages"."answer_reason" is null or "messages"."answer_reason" in ('grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed')),
	CONSTRAINT "messages_citations_array" CHECK (jsonb_typeof("messages"."citations") = 'array' and jsonb_array_length("messages"."citations") <= 20),
	CONSTRAINT "messages_user_has_no_audit_fields" CHECK ("messages"."role" <> 'user' or (
        "messages"."outcome" is null
        and "messages"."citation_validation" is null
        and "messages"."model_id" is null
        and "messages"."answer_reason" is null
        and "messages"."citations" = '[]'::jsonb
      )),
	CONSTRAINT "messages_assistant_audit_fields" CHECK ("messages"."role" <> 'assistant' or (
        "messages"."outcome" is not null
        and "messages"."citation_validation" is not null
        and "messages"."answer_reason" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "support_rate_buckets" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	CONSTRAINT "support_rate_buckets_key_window_unique" UNIQUE("bucket_key","window_start"),
	CONSTRAINT "support_rate_buckets_key_shape" CHECK ("support_rate_buckets"."bucket_key" ~ '^(user|public):[0-9a-f-]{36}:[0-9a-f-]{36,64}$'),
	CONSTRAINT "support_rate_buckets_count_positive" CHECK ("support_rate_buckets"."request_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "support_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"conversation_id" uuid,
	"user_message_id" uuid,
	"assistant_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_submissions_key_uuid" CHECK ("support_submissions"."idempotency_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "support_submissions_complete_links" CHECK ((
        "support_submissions"."status" = 'pending'
        and "support_submissions"."conversation_id" is null
        and "support_submissions"."user_message_id" is null
        and "support_submissions"."assistant_message_id" is null
      ) or (
        "support_submissions"."status" = 'complete'
        and "support_submissions"."conversation_id" is not null
        and "support_submissions"."user_message_id" is not null
        and "support_submissions"."assistant_message_id" is not null
        and "support_submissions"."user_message_id" <> "support_submissions"."assistant_message_id"
      ))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_conversation_customer_fk" FOREIGN KEY ("conversation_id","tenant_id","customer_user_id") REFERENCES "public"."conversations"("id","tenant_id","customer_user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_user_message_fk" FOREIGN KEY ("user_message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_assistant_message_fk" FOREIGN KEY ("assistant_message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "conversations_tenant_customer_updated_idx" ON "conversations" USING btree ("tenant_id","customer_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_submissions_customer_key_unique" ON "support_submissions" USING btree ("tenant_id","customer_user_id","idempotency_key") WHERE "support_submissions"."customer_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "support_submissions_public_key_unique" ON "support_submissions" USING btree ("tenant_id","idempotency_key") WHERE "support_submissions"."customer_user_id" is null;