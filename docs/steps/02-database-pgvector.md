# Step 02: PostgreSQL, Drizzle, and pgvector

- Phase: Foundation
- Depends on: 01
- Status: done
- Spec: sections 4, 5, 13

## Goal

Connect the app to Postgres with `pgvector` using a pooled connection that is safe on Vercel, and make migrations explicit.

## In scope

- Drizzle config, migration folder, and a first migration that enables `vector`.
- Docker Compose for local Postgres with `pgvector`. Document using a Neon branch as an alternative `DATABASE_URL`.
- Server-only database client. One shared pool. No new client per render.
- Readiness checks the database with a short timeout.
- A migration runbook in `docs/runbooks/migrations.md`: apply, and how a bad migration is rolled back. Do not auto-run destructive migrations on startup.
- Integration test that skips cleanly when `DATABASE_URL` is absent, and runs in CI if a Postgres service is configured.

## Out of scope

- Tenant tables beyond what a connectivity smoke test needs. Those belong to Step 03.
- Row Level Security. Revisit after the pool and transaction behavior are understood.

## Acceptance criteria

- Local `docker compose up` yields a database the app can query.
- The vector extension is installed by migration, not by hand.
- Readiness returns not-ready when the database is down, without leaking the connection string.
- The PR documents pooled versus direct connection strings and which one Vercel uses.

## Security and deployment

- `DATABASE_URL` is server-only.
- Preview and production will use different Neon branches. This step only documents that rule. It does not point the app at production.

## Checks

Unit tests, migration applied on local or CI Postgres, typecheck, lint, build.

## Learn in review

Why serverless connection limits change the driver setup, and why migrations are a deliberate operation.

## PR title

`Step 02: Add pooled Postgres, pgvector, and migrations`
