# ADR 0001: Stack defaults

- Status: accepted
- Date: 2026-11-06

## Context

SupportPilot must run as one Next.js application on Vercel, with managed PostgreSQL, tenant isolation, and a controlled AI workflow. The spec already fixes the broad stack. This record locks the defaults agents should use until a later ADR replaces them.

## Decision

- One TypeScript codebase. No Python service and no microservices.
- Next.js App Router, strict TypeScript, Zod, Tailwind. Add shadcn/ui when the first real screen needs it.
- Drizzle ORM and SQL migrations. PostgreSQL with `pgvector`.
- Neon for preview and production databases. Use a pooled connection string in serverless code.
- Local development connects through `DATABASE_URL`. The default local target is Docker Compose Postgres with `pgvector`, so work does not depend on a network database. A Neon branch is an allowed substitute.
- OpenAI for embeddings and generation, behind an application interface, using the official TypeScript SDK.
- Add LangGraph.js in the workflow step, not in the first model call.
- Vitest for unit and integration tests. Mock model providers in CI. Playwright when browser flows exist.
- Production authentication: Auth.js, confirmed 2026-11-06, with a development-only identity selector that production configuration rejects.

## Consequences

- Preview deployments need their own Neon branch or database. They must not use the production connection string.
- Ingestion that can exceed a Vercel request limit needs a durable job later. The document step must not pretend a long HTTP request is a queue.
- Auth.js keeps identity inside the app, which is easier to explain in a review than a second vendor. It is more work than Clerk.

## Alternatives rejected for now

- Supabase as the database: viable, but Neon matches the chosen host and branching model.
- Vercel AI SDK as the orchestration layer: popular for Next.js chat UIs, but the spec asks for an explicit provider boundary and LangGraph only where branching earns it.
- Clerk: faster login UI, extra vendor, and less of the session boundary is visible in the repo.
