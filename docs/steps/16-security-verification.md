# Step 16: Security verification

- Phase: Quality and production
- Depends on: Step 04 and every later product step that has merged
- Status: not_started
- Spec: sections 8, 20

## Goal

Check the security acceptance list against the code that exists, fix gaps, and record anything still open.

## In scope

- Review and tests for: production auth, dev identity disabled in production, server-side checks, tenant isolation in SQL and retrieval, order ownership, upload validation, citation checks, secrets, internal notes, rate limits, prompt injection, preview versus production data, audit coverage.
- Fix defects found. Do not expand product scope.
- Update `docs/security.md` with the threat model and the actual controls.
- Run Cursor Security Review on the branch and address findings you agree with. Note disagreements in the PR.

## Out of scope

- New channels, new roles, or a second auth provider.

## Acceptance criteria

- Each acceptance bullet in spec section 20 is marked met, not yet built, or failed and fixed, with a test name or a doc reference.
- No new secret in the diff.

## Security and deployment

This step is the dedicated pass. It does not excuse missing controls in earlier PRs.

## Checks

Full test suite, security review result, lint, typecheck, build.

## Learn in review

Walk the threat model in under ten minutes: trust boundaries, what the model can influence, and what only the server can do.

## PR title

`Step 16: Verify tenant, auth, and prompt-injection controls`
