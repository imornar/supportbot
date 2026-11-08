# Architecture

SupportPilot is one Next.js application. The browser, route handlers, and server components ship as a single Vercel deployment. There is no Python service and no separate API process.

## Boundaries

- React components render UI. They do not authorize access, choose model tools, or talk to the database.
- Server modules live under `src/server`. Modules that read secrets import `server-only`, so a client component build fails if it imports them.
- A test walks `src` and fails when a `"use client"` file imports `server-only` or `src/server`.
- The model is not part of this step. When it arrives, it still does not get a database connection or a free choice of tools.
- Tenant ownership is a column plus a query filter. `users` are global identities with no password. Membership and role rows carry the tenant id, and a role assignment cannot name a different tenant from its membership. Query helpers take a tenant id and filter in SQL. Row Level Security is deferred for the pooled connection. The conditions are in [`docs/security.md`](security.md).

## Environment

`NEXT_PUBLIC_APP_URL` is the only required variable. It is public by definition. Server secrets such as `DATABASE_URL` and `OPENAI_API_KEY` stay unprefixed and are optional until the step that uses them. Validation errors name the field and omit the value.

## Serverless limits later steps have to respect

Vercel runs this app as short-lived functions:

- State that must survive a request lives in a managed service, not on local disk and not in module memory.
- Sessions, locks, rate limits, and job queues cannot depend on one warm instance.
- Database access needs a pooled connection. A new connection per request will exhaust Neon. The app keeps one `pg` pool for the process. On Vercel that pool allows one connection and uses the Neon pooled connection string. Migrations use the direct string and never run inside a request.
- Work that can exceed the function time limit, such as document ingestion, needs a durable job. A long HTTP request is not a queue.
- Preview and production do not share a database.

Health (`GET /api/health`) reports process liveness only. Readiness (`GET /api/ready`) runs `select 1` with a two-second connection and query timeout. `database: "up"` is HTTP 200. A missing `DATABASE_URL` is `not_configured`, and a failed check is `down`. Both are HTTP 503. The body and the error log never include the connection string.
