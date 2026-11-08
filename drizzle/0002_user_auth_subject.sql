ALTER TABLE "users" ADD COLUMN "auth_provider" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_subject" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_identity_pair" CHECK ((
        "users"."auth_provider" is null and "users"."auth_subject" is null
      ) or (
        "users"."auth_provider" is not null and "users"."auth_subject" is not null
      ));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_shape" CHECK ("users"."auth_provider" is null or "users"."auth_provider" ~ '^[a-z][a-z0-9_-]{0,31}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_subject_shape" CHECK ("users"."auth_subject" is null or (
        char_length("users"."auth_subject") between 1 and 255
        and "users"."auth_subject" !~ '[[:space:]]'
      ));