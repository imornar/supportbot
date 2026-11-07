# AGENTS.md

SupportPilot is a multi-tenant AI support application. [`spec.md`](spec.md) is the product source of truth. This file is the working agreement for coding agents.

## How to work

1. Read `spec.md`, this file, and the active step in `docs/steps/`.
2. Implement only that step. Do not start the next one.
3. Use one branch and one pull request: `step-NN-short-name`.
4. State the plan, acceptance criteria, security impact, and deployment impact before editing.
5. Keep business logic out of React components. Keep model providers behind application interfaces.
6. Add or update tests and the docs that describe the behavior you changed.
7. Run formatting, lint, typecheck, and the relevant tests. Report the real result.
8. Commit, push, and open a pull request. Never merge it. Stop and wait for the user.

The user reviews every pull request. That review is the human gate for this project. A green CI check or a Greptile score is evidence for the reviewer, not permission to merge.

## Stack defaults

These hold unless an ADR changes them:

- Next.js App Router, TypeScript strict, Tailwind, Zod, one deployable app on Vercel.
- Drizzle ORM, PostgreSQL, `pgvector`, pooled connections suitable for serverless.
- Neon for preview and production. Local development uses `DATABASE_URL`, normally a Docker Postgres image with `pgvector`.
- OpenAI through a replaceable provider interface. No Python service.
- LangGraph.js only when a step needs explicit branching, state, tools, and escalation. Do not wrap a single prompt in a framework.
- Vitest in CI. Playwright for the critical browser flows once those screens exist.
- Auth.js is the production auth provider, with a development-only identity selector that production rejects.

## Security rules that apply on every step

- Derive tenant and user from the verified server session. Never trust a client-supplied tenant id.
- Enforce permissions on the server. Hiding UI is not authorization.
- The model never receives a database connection, unrestricted tools, or another tenant's data.
- Treat user text and uploaded documents as untrusted. Prompts are not a security boundary.
- Validate model output. Citations must point at evidence that was actually retrieved.
- Secrets stay in server environment variables. Never prefix a secret with `NEXT_PUBLIC_`.
- Development identity shortcuts must be impossible to enable in production.
- Do not log secrets, raw tokens, or full conversation content by default.

## Review tools

After the pull request exists:

- Run Cursor Bugbot on every step.
- Run Security Review on steps that touch auth, tenants, uploads, retrieval, tools, or tickets.
- Use Greptile `cli-review` or `check-pr` so the user can read the findings.
- Use `greploop` only when the user asks. It pushes follow-up commits. It must not merge.

## Definition of done

A step is done when its acceptance criteria pass, checks were actually run, the PR describes decisions and limitations, and the user has approved it. Then update that step's status in `docs/roadmap.md` in the following pull request, or in the same PR if the user asked to mark it done before merge.
