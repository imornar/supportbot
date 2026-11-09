ALTER TABLE "messages" DROP CONSTRAINT "messages_answer_reason";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_user_has_no_audit_fields";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_assistant_audit_fields";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "outcome" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "workflow_intent" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_outcome" CHECK ("messages"."outcome" is null or "messages"."outcome" in ('answered', 'clarified', 'abstained', 'escalated'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workflow_intent" CHECK ("messages"."workflow_intent" is null or "messages"."workflow_intent" in ('human_request', 'possible_order', 'ordinary', 'needs_clarification'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_escalation_reason" CHECK ("messages"."escalation_reason" is null or "messages"."escalation_reason" in ('customer_requested_human', 'business_tool_unavailable', 'workflow_failure'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_answer_reason" CHECK ("messages"."answer_reason" is null or "messages"."answer_reason" in ('grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed', 'clarification_needed', 'customer_requested_human', 'business_tool_unavailable', 'workflow_failure'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_has_no_audit_fields" CHECK ("messages"."role" <> 'user' or (
        "messages"."outcome" is null
        and "messages"."citation_validation" is null
        and "messages"."model_id" is null
        and "messages"."answer_reason" is null
        and "messages"."workflow_intent" is null
        and "messages"."escalation_reason" is null
        and "messages"."citations" = '[]'::jsonb
      ));--> statement-breakpoint
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
            and "messages"."outcome" = 'escalated'
            and "messages"."answer_reason" = 'business_tool_unavailable'
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
      ));--> statement-breakpoint
DROP TYPE "public"."message_outcome";