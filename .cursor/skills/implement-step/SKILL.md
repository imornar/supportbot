---
name: implement-step
description: Implements one SupportPilot roadmap step as a single reviewable pull request. Use when the user asks to start, implement, or continue a step, or names a file in docs/steps.
---

# Implement one SupportPilot step

## Before editing

1. Read `spec.md`, `AGENTS.md`, `docs/roadmap.md`, and the requested `docs/steps/NN-*.md`.
2. Inspect the repo. Refuse to implement a step whose dependencies are not merged unless the user explicitly overrides that.
3. Reply with the plan, acceptance criteria, security impact, and deployment impact. Then implement. Do not wait for a second confirmation unless a decision in the step file is still open.

## Branch and scope

- Branch from the default branch: `step-NN-short-name`.
- Change only what that step lists as in scope.
- If a small fix outside scope is required for the step to function, call it out in the PR. Do not quietly absorb the next step.

## Checks

Run the project's format, lint, typecheck, and test commands when they exist. For a docs-only step, say that runtime checks do not apply yet.

## Pull request

Commit and open a PR. Use `.github/pull_request_template.md`. Include:

- what changed and why
- decisions and alternatives rejected
- checks actually run and their results
- security and deployment notes
- limitations
- what the reviewer should focus on to learn the step

Do not merge. Stop after the PR URL is available. If GitHub is unreachable, report the branch and commit and do not invent a PR link.

## Review

Mention that the user can run Bugbot, and Security Review when the step touches auth, tenants, documents, retrieval, tools, or tickets. Do not start `greploop` unless the user asked for it in this turn.
