CREATE TYPE "public"."order_status" AS ENUM('placed', 'shipped', 'delivered');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "customers_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"status" "order_status" NOT NULL,
	"placed_on" date NOT NULL,
	"summary" text NOT NULL,
	"internal_notes" text NOT NULL,
	"payment_instrument" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_number_unique" UNIQUE("tenant_id","order_number"),
	CONSTRAINT "orders_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "orders_number_shape" CHECK ("orders"."order_number" ~ '^[0-9]{1,12}$'),
	CONSTRAINT "orders_summary_length" CHECK (char_length("orders"."summary") between 1 and 500),
	CONSTRAINT "orders_internal_notes_length" CHECK (char_length("orders"."internal_notes") between 1 and 2000),
	CONSTRAINT "orders_payment_instrument_length" CHECK (char_length("orders"."payment_instrument") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_answer_reason";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_assistant_audit_fields";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_tenant_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customers"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_answer_reason" CHECK ("messages"."answer_reason" is null or "messages"."answer_reason" in ('grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed', 'clarification_needed', 'customer_requested_human', 'business_tool_unavailable', 'workflow_failure', 'order_lookup', 'order_not_found', 'order_unavailable', 'sign_in_required'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_assistant_audit_fields" CHECK ("messages"."role" <> 'assistant' or (
        "messages"."outcome" is not null
        and "messages"."citation_validation" is not null
        and "messages"."answer_reason" is not null
        and "messages"."workflow_intent" is not null
        and (
          (
            "messages"."outcome" = 'escalated'
            and "messages"."escalation_reason" is not null
            and "messages"."answer_reason" = "messages"."escalation_reason"
          ) or (
            "messages"."outcome" <> 'escalated'
            and "messages"."escalation_reason" is null
          )
        )
        and (
          (
            "messages"."workflow_intent" = 'human_request'
            and "messages"."outcome" = 'escalated'
            and "messages"."answer_reason" = 'customer_requested_human'
          ) or (
            "messages"."workflow_intent" = 'possible_order'
            and (
              (
                "messages"."outcome" = 'answered'
                and "messages"."answer_reason" = 'order_lookup'
              ) or (
                "messages"."outcome" = 'abstained'
                and "messages"."answer_reason" in ('order_not_found', 'order_unavailable')
              ) or (
                "messages"."outcome" = 'clarified'
                and "messages"."answer_reason" = 'sign_in_required'
              ) or (
                "messages"."outcome" = 'escalated'
                and "messages"."answer_reason" in ('business_tool_unavailable', 'workflow_failure')
              )
            )
          ) or (
            "messages"."workflow_intent" = 'needs_clarification'
            and "messages"."outcome" = 'clarified'
            and "messages"."answer_reason" = 'clarification_needed'
          ) or (
            "messages"."workflow_intent" = 'ordinary'
            and (
              (
                "messages"."outcome" in ('answered', 'abstained')
                and "messages"."answer_reason" in ('grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed')
              ) or (
                "messages"."outcome" = 'escalated'
                and "messages"."answer_reason" = 'workflow_failure'
              )
            )
          )
        )
      ));