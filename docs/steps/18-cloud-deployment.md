# Step 18: Cloud deployment

- Phase: Quality and production
- Depends on: 02, 17
- Status: not_started
- Spec: sections 5, 23, 24

## Goal

Run the built slice on Vercel against a Neon database, with preview isolated from production.

## In scope

- Vercel project, production and preview env vars, no secrets in git.
- Neon production branch and a separate preview branch. Document how a preview deployment gets its `DATABASE_URL`.
- Apply migrations deliberately to each database. Record the command in `docs/deployment.md` and `docs/runbooks/migrations.md`.
- Backup and restore notes for Neon: what exists by default and how you would recover.
- Smoke the deployed health, readiness, one grounded answer or fixture path, and one forbidden cross-tenant request.
- Rollback: how to redeploy a previous Vercel deployment and what that does not undo in the database.

## Out of scope

- Kubernetes, a custom domain requirement, production load testing.

## Acceptance criteria

- Preview cannot read production rows. Describe the proof you ran.
- A secret scan of the repo stays clean.
- `docs/deployment.md` matches the commands actually used.
- The PR lists deployed URLs and the smoke results. Do not claim a URL works unless you requested it.

## Security and deployment

This is the production cutover for whatever scope has merged. Disable the development identity flag in preview and production and verify the rejection.

## Checks

CI on the PR, plus the deployed smoke checks recorded in the PR.

## Learn in review

How preview data stays separate, how you would roll back an app bug, and what a migration rollback cannot promise.

## PR title

`Step 18: Deploy to Vercel and Neon with isolated preview`
