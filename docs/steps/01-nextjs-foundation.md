# Step 01: Next.js application foundation

- Phase: Foundation
- Depends on: 00
- Status: not_started
- Spec: sections 4, 5, 14

## Goal

Create a strict Next.js App Router app that builds the way Vercel will build it, with env validation and health endpoints.

## In scope

- Current stable Next.js, React, and TypeScript strict mode. Node LTS that Vercel supports for that Next.js version.
- Tailwind, ESLint, Prettier, Vitest.
- Zod validation for server environment variables. `.env.example` with placeholders only.
- `GET /api/health` and `GET /api/ready`. Readiness may report "database not configured" until Step 02.
- A minimal home page that names the app and links to health.
- GitHub Actions for lint, typecheck, unit tests, and `next build`.
- `docs/architecture.md` with the one-app boundary. `docs/deployment.md` stub for local, preview, and production.

## Out of scope

- Database, auth, shadcn component set, AI SDK, LangGraph.

## Acceptance criteria

- `next build` succeeds with no secrets required for the health route.
- Missing required public config fails with an error that does not print secret values.
- CI runs on the pull request.
- Server-only modules cannot be imported into client components. Add one focused test or lint boundary if the framework does not already enforce it.

## Security and deployment

- No `NEXT_PUBLIC_` secrets.
- Health responses contain no connection strings or host internals beyond a status.
- Confirm the Vercel project region can reach Neon later. Do not create the Vercel project in this step unless the user asks.

## Checks

Format, lint, typecheck, Vitest, production build.

## Learn in review

Why the app is one deployable unit, why env validation happens on the server, and which limits of serverless execution the later steps have to respect.

## PR title

`Step 01: Scaffold the Next.js app and health checks`
