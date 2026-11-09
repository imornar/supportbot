# Database migrations

Migrations are a deliberate operation. The Next.js process does not run them on startup, on a cold start, or from a readiness check.

Drizzle Kit applies SQL files in `drizzle/` and records them in `public.__drizzle_migrations`. The first migration enables the `vector` extension. Do not create that extension by hand. The next migration creates tenants, users, memberships, role assignments, and audit events. A later migration adds `users.auth_provider` and `users.auth_subject` for the GitHub subject. `0003_document_ingestion` adds `documents` and `document_chunks`, including a `vector(1536)` column. `0004_conversations` adds `conversations`, `messages`, `support_submissions`, and `support_rate_buckets`. Development seed data is not in those files. Load it with `npm run db:seed` only against a local database. See [`docs/security.md`](../security.md).

## Connection strings

| Variable       | Who uses it                         | Neon                                             | Local Docker                                                         |
| -------------- | ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL` | The app, including Vercel           | Pooled hostname, the one that contains `-pooler` | `postgresql://supportpilot:supportpilot@localhost:5432/supportpilot` |
| `DIRECT_URL`   | `npm run db:migrate` when it is set | Direct hostname, no `-pooler`                    | Leave unset. The migrate command falls back to `DATABASE_URL`.       |

Vercel runs the application, so the Vercel environment variable is the pooled `DATABASE_URL`. Put `DIRECT_URL` on the machine or job that applies migrations. A transaction-mode pooler can break migration locks and multi-statement scripts, which is why those two strings stay separate.

Preview and production use different Neon branches. A preview `DATABASE_URL` must not be the production database. This step does not create those branches.

## Apply

Local Docker:

1. `docker compose up -d`
2. Wait until `docker compose ps` shows the database as healthy.
3. Copy `.env.example` to `.env.local` if you have not already. The sample `DATABASE_URL` matches Compose.
4. `npm run db:migrate`

The migrate command reads `.env.local`, then `.env`, and does not override variables already exported in the shell. Running it a second time applies nothing new when the migration files are unchanged.

A Neon branch is an optional substitute for Docker. Use that branch's pooled string as `DATABASE_URL` and its direct string as `DIRECT_URL`, then run the same migrate command. Creating the Neon project is not part of this step.

## Roll back a bad migration

Drizzle Kit does not generate down migrations. Do not edit a SQL file that has already been applied. The stored checksum will no longer match, and the next migrate will fail.

Prefer a new forward migration that reverses the change. For the `vector` extension, before any column depends on it, that reverse statement is:

```sql
DROP EXTENSION IF EXISTS vector;
```

Once later steps store vector columns, dropping the extension is destructive. Restore data instead of inventing a down script:

- Neon: create a branch or restore from the point in time before the migration, then point `DIRECT_URL` and `DATABASE_URL` at that branch.
- Local Docker only: `docker compose down -v` deletes the local volume. That is a local reset. It is not a production rollback.

After a restore, run `npm run db:migrate` so the migration table matches the files in `drizzle/`.
