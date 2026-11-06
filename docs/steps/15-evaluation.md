# Step 15: Evaluation harness

- Phase: Quality and production
- Depends on: 06, 07, 09
- Status: not_started
- Spec: section 18

## Goal

Make answer quality, retrieval, abstention, and abuse cases repeatable without a paid API call in CI.

## In scope

- Versioned dataset: single source, multi-source, missing, conflicting, outdated, cross-tenant, prompt injection in the question, prompt injection in a document, unauthorized order, explicit human request, provider failure.
- Deterministic graders for retrieval ids, citation validity, abstention, escalation, and auth failures.
- A command that writes a short report: pass/fail by case, latency of the local run, and estimated cost left blank unless a live key is configured.
- Live OpenAI eval is opt-in and documented. CI uses fixtures.
- Update `docs/evaluation.md` with the latest local results and what the dataset does not prove.

## Out of scope

- A hosted eval product, fine-tuning, LLM-as-judge as the only gate. A judge may be documented as a future supplement.

## Acceptance criteria

- CI fails when a citation or tenant-isolation case regresses.
- The report distinguishes "not measured" from a passing score.
- Dataset contains no real customer data and no secrets.

## Security and deployment

Injection cases must show that the document or question cannot expand the caller's permissions.

## Checks

The eval command in CI, lint, typecheck.

## Learn in review

Which metric you trust, what a live model run would add, and how you would change one case during the call.

## PR title

`Step 15: Add a fixture-based support evaluation suite`
