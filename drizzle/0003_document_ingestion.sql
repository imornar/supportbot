CREATE TYPE "public"."document_publication" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('markdown', 'text');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"section" text,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_document_index_unique" UNIQUE("document_id","chunk_index"),
	CONSTRAINT "document_chunks_index_non_negative" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_version_positive" CHECK ("document_chunks"."document_version" >= 1),
	CONSTRAINT "document_chunks_content_length" CHECK (char_length("document_chunks"."content") between 1 and 2000),
	CONSTRAINT "document_chunks_section_length" CHECK ("document_chunks"."section" is null or char_length("document_chunks"."section") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"version" integer NOT NULL,
	"publication" "document_publication" DEFAULT 'draft' NOT NULL,
	"checksum" text NOT NULL,
	"body" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"effective_date" date,
	"ingestion_status" "ingestion_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"supersedes_document_id" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "documents_id_version_unique" UNIQUE("id","version"),
	CONSTRAINT "documents_title_length" CHECK (char_length("documents"."title") between 1 and 200),
	CONSTRAINT "documents_source_length" CHECK (char_length("documents"."source") between 1 and 500),
	CONSTRAINT "documents_version_positive" CHECK ("documents"."version" >= 1),
	CONSTRAINT "documents_checksum_shape" CHECK ("documents"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "documents_body_size" CHECK (octet_length("documents"."body") between 1 and 262144),
	CONSTRAINT "documents_not_self_supersede" CHECK ("documents"."supersedes_document_id" is null or "documents"."supersedes_document_id" <> "documents"."id"),
	CONSTRAINT "documents_retired_not_current" CHECK ("documents"."publication" <> 'retired' or "documents"."is_current" = false),
	CONSTRAINT "documents_failure_reason" CHECK ((
        "documents"."ingestion_status" = 'failed'
        and "documents"."failure_reason" in (
          'too_large_for_sync_ingestion',
          'embedding_not_configured',
          'embedding_failed',
          'ingestion_failed'
        )
      ) or (
        "documents"."ingestion_status" <> 'failed' and "documents"."failure_reason" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_tenant_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_fk" FOREIGN KEY ("document_id","document_version") REFERENCES "public"."documents"("id","version") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supersedes_tenant_fk" FOREIGN KEY ("supersedes_document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "document_chunks_tenant_document_idx" ON "document_chunks" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "documents_current_checksum_unique" ON "documents" USING btree ("tenant_id","checksum") WHERE "documents"."is_current" = true;--> statement-breakpoint
CREATE INDEX "documents_tenant_id_idx" ON "documents" USING btree ("tenant_id");