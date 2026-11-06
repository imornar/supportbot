# Step 09: Controlled support workflow

- Phase: Knowledge and AI
- Depends on: 07, 08
- Status: not_started
- Spec: sections 9.1, 11, 16

## Goal

Replace a straight-line "retrieve then answer" call with an explicit, testable workflow: classify, retrieve, judge evidence, answer or abstain or escalate.

## In scope

- LangGraph.js state graph with small typed nodes. If a graph does not make the branches clearer than plain functions, stop and record that in an ADR, then keep the plain functions. Do not add the dependency for show.
- States for answer, clarify, abstain, and escalate. Escalation returns a reason. It does not create the ticket row until Step 11, but the decision is stable enough for that step to consume.
- Intent classification is a structured model call or a deterministic rule for the cases tests care about: human request, possible order question, ordinary question.
- Persist the workflow outcome on the message.
- Tests for each branch using scripted models.
- Timeouts around model nodes. No unbounded loops.

## Out of scope

- Real order lookup, ticket tables, email.

## Acceptance criteria

- A "talk to a human" message takes the escalate branch and does not invent an answer.
- Insufficient evidence abstains or asks a clarification, matching the step 07 rules.
- A node test can run without the HTTP layer.
- The graph cannot choose an undeclared tool.

## Security and deployment

Authorization stays outside the graph. Nodes receive an already authorized context object. The graph has no database credentials.

## Checks

Workflow unit tests, existing conversation tests still pass, lint, typecheck, build.

## Learn in review

Why this is a workflow and not an autonomous agent. Which node you would edit live to change escalation behavior.

## PR title

`Step 09: Add an explicit answer and escalation workflow`
