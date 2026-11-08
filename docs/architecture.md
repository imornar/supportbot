# Architecture

SupportPilot is one Next.js application. The browser, route handlers, and server components ship as a single Vercel deployment. There is no Python service and no separate API process.

## Boundaries

- React components render UI. They do not authorize access, choose model tools, or talk to the database.
- Server modules live under `src/server`. Modules that read secrets import `server-only`, so a client component build fails if it imports them.
- A test walks `src` and fails when a `"use client"` file imports `server-only` or `src/server`.
- The embedding provider is an application interface. Tests and local development without a real `OPENAI_API_KEY` use a fake embedder. A configured key uses the official OpenAI SDK for `text-embedding-3-small`. The provider receives chunk text only. It does not receive a database connection, and the model does not choose tools.
- Document text is stored in Postgres (`documents.body` and `document_chunks.content`). The API accepts JSON text, not a multipart file, and nothing is written to local disk. Chunks are heading-aware slices of at most 1200 characters, with 150 characters of overlap only when a single paragraph is longer than that. Retrieval is the next step.
- Tenant ownership is a column plus a query filter. `users` are global identities with no password. Auth.js maps a GitHub subject onto a user. Membership and role rows carry the tenant id, and a role assignment cannot name a different tenant from its membership. `requirePermission` loads those roles for the resource tenant on each request. Query helpers take a tenant id and filter in SQL. Row Level Security is deferred for the pooled connection. The conditions are in [`docs/security.md`](security.md).

## Environment

`NEXT_PUBLIC_APP_URL` is the only variable required to render the home page. It is public by definition. `AUTH_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET` stay unprefixed. A real GitHub login needs them. The development identity switch does not. Server secrets such as `DATABASE_URL` and `OPENAI_API_KEY` stay unprefixed. Validation errors name the field and omit the value.

## Serverless limits later steps have to respect

Vercel runs this app as short-lived functions:

- State that must survive a request lives in a managed service, not on local disk and not in module memory.
- Sessions, locks, rate limits, and job queues cannot depend on one warm instance.
- Database access needs a pooled connection. A new connection per request will exhaust Neon. The app keeps one `pg` pool for the process. On Vercel that pool allows one connection and uses the Neon pooled connection string. Migrations use the direct string and never run inside a request.
- Work that can exceed the function time limit, such as document ingestion, needs a durable job. A long HTTP request is not a queue. Markdown and plain text up to 64 KB are chunked and embedded inside the upload request. Larger texts are stored and marked failed with `too_large_for_sync_ingestion`. A durable worker is the follow-up. This step does not poll or retry in the background.
- Preview and production do not share a database.

Health (`GET /api/health`) reports process liveness only. Readiness (`GET /api/ready`) runs `select 1` with a two-second connection and query timeout. `database: "up"` is HTTP 200. A missing `DATABASE_URL` is `not_configured`, and a failed check is `down`. Both are HTTP 503. The body and the error log never include the connection string.
