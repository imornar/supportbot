ALTER TABLE "tenants" ADD COLUMN "public_support_name" text DEFAULT 'A support agent' NOT NULL;--> statement-breakpoint
UPDATE "tenants" SET "public_support_name" = "name" WHERE "name" ~ '^[A-Za-z0-9][A-Za-z0-9 .&-]{0,79}$';--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_public_support_name_length" CHECK (char_length("tenants"."public_support_name") between 1 and 80);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_public_support_name_shape" CHECK ("tenants"."public_support_name" ~ '^[A-Za-z0-9][A-Za-z0-9 .&-]{0,79}$');