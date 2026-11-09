# Deployment

The Vercel project is not created in this step. Preview and production stay undeployed until the cloud deployment step. You do not need a Neon account to develop or to merge this step.

Vercel and Neon have to be in regions that can reach each other. Pick that pair when the Neon database and the Vercel project are created. Do not point a preview deployment at the production database.

Node.js `26.x` is the version Vercel uses by default for new projects, and it is the current LTS that Next.js 16 accepts. `package.json` sets `engines.node` to `26.x`. GitHub Actions uses the same major.

## Local

1. Install Node.js 26.
2. `docker compose up -d` and wait until the database is healthy. The image is `pgvector/pgvector:pg17`. A Neon branch can stand in for Docker: put its pooled URL in `DATABASE_URL` and its direct URL in `DIRECT_URL`. Creating that Neon project is optional.
3. Copy `.env.example` to `.env.local`. The sample `DATABASE_URL` matches Compose. Set `NEXT_PUBLIC_APP_URL` to the local origin, usually `http://localhost:3000`.
4. `npm install`
5. `npm run db:migrate`
6. `npm run db:seed` loads two local tenants and example users. It stores no passwords. It refuses production, preview, and any Vercel runtime. Skip it if you do not need the sample identities. Sample articles for manual upload live in `fixtures/knowledge/harbor/`. The seed does not load them.
7. For the development identity switch, set `SUPPORTPILOT_ALLOW_DEV_IDENTITY=true` in `.env.local`. `npm run dev` is the process that honors it. `next start` sets `NODE_ENV=production` and rejects the switch.
8. GitHub login needs `AUTH_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET`. The OAuth callback is `http://localhost:3000/api/auth/callback/github`. This repository does not ship those credentials.
9. `npm run dev`

The app builds with no live database. `NEXT_PUBLIC_APP_URL` is required because the home page reads it on the server. Health does not. Readiness opens a short database check only when the route is called.

Migration commands, pooled versus direct strings, and rollback are in [`docs/runbooks/migrations.md`](runbooks/migrations.md).

## What Vercel uses

When the project exists, set `DATABASE_URL` in Vercel to the Neon pooled connection string. The app keeps one shared `pg` pool per warm instance, with a maximum of one connection on Vercel, so instances do not exhaust Neon. Migrations are not part of `next start`. Apply them with `npm run db:migrate` using `DIRECT_URL` before, or as a separate step from, the deployment that serves traffic.

## Authentication secrets

`AUTH_SECRET` signs the Auth.js session. Preview and production each get their own value. `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are the GitHub OAuth app for that environment. GitHub allows one callback URL per app, so a preview host that should accept login needs its own app. Leave `AUTH_URL` unset on Vercel. Setting it to the production origin would send preview callbacks there.

`SUPPORTPILOT_ALLOW_DEV_IDENTITY` stays unset on Vercel. Production configuration rejects the development identity header, cookie, and query parameter even if the variable is `true`.

`OPENAI_API_KEY` is optional for local ingestion. The placeholder in `.env.example` selects the fake embedder. Preview and production need a real key or document ingestion fails closed. The same key is what a chat completion uses. A missing or placeholder key does not generate an answer. The key is server-only.

`SUPPORTPILOT_AI_REQUEST_TIMEOUT_MS` is the per-attempt chat timeout. Unset means 10000. The allowed range is 1000 to 30000. Transient failures retry twice, so a 30000 millisecond timeout can spend about 90 seconds plus a short backoff. Lower it when the function limit is shorter than that. The value is not a secret.

`RETRIEVAL_TOP_K` and `RETRIEVAL_SIMILARITY_THRESHOLD` are optional. Unset, they are 5 and 0.3. A deployment can leave them unset. They are not secrets and must not use the `NEXT_PUBLIC_` prefix. Changing them does not require a migration.

## Preview

- A Vercel preview deployment for the pull request.
- Its own Neon branch or database, with non-production keys.
- Pooled `DATABASE_URL` for that branch only.
- Its own `AUTH_SECRET`. Its own GitHub OAuth app when preview login should work.
- The same public app URL variable, set to that preview origin.
- No production data.

## Production

- The Vercel production deployment in a region that can reach the production Neon database.
- Production secrets in Vercel environment variables, never in `NEXT_PUBLIC_` variables. That includes `AUTH_SECRET` and the GitHub client secret.
- A separate production Neon branch, pooled string in `DATABASE_URL`.
- Migrations run as an explicit step, not on every cold start.

Creating the Vercel project, the Neon branches, and the real secrets is later work.
