# Step 00: Repository and agent workflow

- Phase: Foundation
- Depends on: none
- Status: done
- Spec: sections 21, 23, 25

## Goal

Make the repository a place where an agent can implement one small step, and a human can review it, without product code yet.

## In scope

- `AGENTS.md`, Cursor rule, and the `implement-step` skill.
- `docs/roadmap.md`, `docs/steps/*`, `docs/project-spec.md`.
- ADR 0001 with the proposed stack.
- Pull request template, `README.md`, `.gitignore`.
- Initialize git and open the pull request once a GitHub repo exists.

## Out of scope

- Next.js, database, CI workflow that needs a package.json, authentication, or any feature.

## Acceptance criteria

- A new agent can find the active step, the security rules, and the instruction to stop after one PR.
- The roadmap has one PR per step and a shorter path for the assessment demo.
- No secrets and no application runtime.

## Security and deployment

Documentation only. `.gitignore` must ignore `.env` before any secret is created.

## Checks

Not applicable until the Node project exists. Review the docs for contradictions with `spec.md`.

## Learn in review

This is the control plane for the later build: spec, agent instructions, and a human merge gate. Be able to say why the agent is not allowed to keep going after a PR.

## PR title

`Step 00: Add agent workflow and implementation roadmap`
