# Step 19: Assessment readiness

- Phase: Quality and production
- Depends on: the deployed slice from Step 18
- Status: not_started
- Spec: sections 1, 24, 25

## Goal

Leave a package you can walk through in 60 minutes, including a small live change.

## In scope

- Architecture diagram in `docs/architecture.md`: browser, Next.js, workflow, Postgres, OpenAI, human inbox.
- ADRs for any decision that replaced ADR 0001.
- Threat model, eval results, latency and cost notes, known limitations.
- A demo script: seeded users, one answered question, one abstention, one human escalation, one blocked cross-tenant attempt.
- Three reviewer questions you can answer, and one live edit you have rehearsed. Good live edits: change the similarity threshold, add an eval case, or tighten a permission.
- A short prompting log is optional and only if you want it in the submission. Do not include secrets or private transcripts.

## Out of scope

- New product features disguised as documentation.

## Acceptance criteria

- Another person can run the demo from the README and the demo script.
- Limitations are specific: what is mocked, what is not deployed, what an attacker could still try.
- The diagram matches the code.

## Security and deployment

The demo uses seeded data, not real customers.

## Checks

Follow the demo script yourself against the deployed app when it exists, or against local if deployment is not done. Record which one.

## Learn in review

You should be able to defend the architecture, the tradeoffs, and the human gates without reading the docs line by line.

## PR title

`Step 19: Add the architecture, demo script, and review notes`
