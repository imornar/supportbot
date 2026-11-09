# SupportPilot roadmap

Each file in [`docs/steps/`](./steps/) is one pull request. Dependencies are merge order, not a suggestion to combine steps.

Status values: `not_started`, `in_progress`, `in_review`, `done`.

| Step                                      | Title                                | Depends on                                | Status      |
| ----------------------------------------- | ------------------------------------ | ----------------------------------------- | ----------- |
| [00](./steps/00-repository-foundation.md) | Repository and agent workflow        | none                                      | done        |
| [01](./steps/01-nextjs-foundation.md)     | Next.js application foundation       | 00                                        | done        |
| [02](./steps/02-database-pgvector.md)     | PostgreSQL, Drizzle, and pgvector    | 01                                        | done        |
| [03](./steps/03-tenant-audit-schema.md)   | Tenant, membership, and audit schema | 02                                        | done        |
| [04](./steps/04-auth-and-permissions.md)  | Authentication and permissions       | 03                                        | in_review   |
| [05](./steps/05-document-ingestion.md)    | Document ingestion                   | 04                                        | in_review   |
| [06](./steps/06-retrieval.md)             | Tenant-scoped retrieval              | 05                                        | in_review   |
| [07](./steps/07-grounded-answers.md)      | Grounded answers and citations       | 06                                        | in_review   |
| [08](./steps/08-conversations-api.md)     | Conversations API                    | 04, 07                                    | not_started |
| [09](./steps/09-support-workflow.md)      | Controlled support workflow          | 07, 08                                    | not_started |
| [10](./steps/10-order-lookup.md)          | Authorized order lookup              | 04, 09                                    | not_started |
| [11](./steps/11-tickets.md)               | Tickets and escalation               | 08, 09                                    | not_started |
| [12](./steps/12-staff-operations.md)      | Staff and admin operations           | 05, 11                                    | not_started |
| [13](./steps/13-customer-ui.md)           | Customer chat UI                     | 08, 09, 11                                | not_started |
| [14](./steps/14-staff-ui.md)              | Staff and admin UI                   | 12, 13                                    | not_started |
| [15](./steps/15-evaluation.md)            | Evaluation harness                   | 06, 07, 09                                | not_started |
| [16](./steps/16-security-verification.md) | Security verification                | 04 through the latest merged product step | not_started |
| [17](./steps/17-observability.md)         | Reliability and observability        | 09, 11                                    | not_started |
| [18](./steps/18-cloud-deployment.md)      | Cloud deployment                     | 02, 17                                    | not_started |
| [19](./steps/19-assessment.md)            | Assessment readiness                 | the deployed slice                        | not_started |

## What the three-day review has to show

The certificate task is a design plus a proof of concept of the riskiest part, then a live walkthrough. The riskiest part of this system is not the chat screen. It is a tenant-scoped retrieval and answer path that cites real evidence, abstains when evidence is weak, and hands off to a human without the model granting itself permission.

If time is short, finish and deploy this slice, and be ready to explain the rest as designed but not built:

00, 01, 02, 03, 04, 05, 06, 07, 09, 11, 18, 19.

Staff UI, order lookup, and the full eval report can follow. Do not skip server-side authorization in order to reach the UI.

## Human gates

- You approve every merge.
- The model classifies and drafts. The server authorizes, validates citations, and decides which tools exist.
- A ticket is not "accepted by a human" until an authorized agent claims it.
- Greptile and Bugbot can request changes. They do not replace your reading of the diff.

## Decisions locked on 2026-11-06

- Production auth is Auth.js.
- Local database is Docker Postgres with `pgvector`. Preview and production are separate Neon branches.
- Review skills: Greptile `cli-review`, `check-pr`, and `greploop`, plus Cursor Bugbot and Security Review. `greploop` runs only when you ask. It may push commits. It must not merge.
- Git remote: `git@github.com:imornar/supportbot.git`.
