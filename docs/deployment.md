# Deployment

The Vercel project is not created in this step. Preview and production stay undeployed until the cloud deployment step.

Vercel and Neon have to be in regions that can reach each other. Pick that pair when the Neon database and the Vercel project are created. Do not point a preview deployment at the production database.

Node.js `26.x` is the version Vercel uses by default for new projects, and it is the current LTS that Next.js 16 accepts. `package.json` sets `engines.node` to `26.x`. GitHub Actions uses the same major.

## Local

1. Install Node.js 26.
2. Copy `.env.example` to `.env.local` and keep the placeholder secrets. Set `NEXT_PUBLIC_APP_URL` to the local origin, usually `http://localhost:3000`.
3. `npm install`
4. `npm run dev`

The app builds with no real secrets. `NEXT_PUBLIC_APP_URL` is required because the home page reads it on the server. Health does not.

Docker Postgres arrives in Step 02. Until then, readiness reports that the database is not configured.

## Preview

- A Vercel preview deployment for the pull request.
- Its own Neon branch or database, with non-production keys.
- The same public app URL variable, set to that preview origin.
- No production data.

## Production

- The Vercel production deployment in a region that can reach the production Neon database.
- Production secrets in Vercel environment variables, never in `NEXT_PUBLIC_` variables.
- Migrations run as an explicit step, not on every cold start.

Those environments are a stub here. Creating the project, the database, and the real secrets is later work.
