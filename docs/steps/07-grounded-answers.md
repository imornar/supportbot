# Step 07: Grounded answers and citations

- Phase: Knowledge and AI
- Depends on: 06
- Status: not_started
- Spec: sections 10, 11, 16, 18

## Goal

Generate a structured answer from retrieved evidence, or abstain. Reject citations the model invents.

## In scope

- Provider interface for a chat completion with timeout, bounded retries, and a recorded model name.
- Zod schema for the model output: answer, citations, abstained flag, conflict flag.
- Citation validator: every cited id must be in the evidence set passed to the model.
- Conflict behavior: if the evidence disagrees and no precedence rule resolves it, abstain.
- Insufficient evidence abstains. A provider error abstains or returns a safe error. It never fills in a plausible answer.
- Unit tests with scripted model responses, including an invented citation, a conflict, and an empty retrieval.
- Token usage captured in memory for the caller to persist later. No full prompt logging.

## Out of scope

- LangGraph, conversation persistence, tickets, the chat page.

## Acceptance criteria

- Invented citation fails validation and the user-facing result does not include it.
- Empty retrieval does not call the model with an instruction to answer anyway, or the answer is forced to abstain before it is returned. Prefer skipping the generation call when there is no evidence.
- Tests do not call OpenAI.

## Security and deployment

Retrieved document text is untrusted. The system prompt cannot authorize tools or extra tenants. Timeouts are finite.

## Checks

Schema tests, citation tests, abstention tests, lint, typecheck, build.

## Learn in review

This is the riskiest AI behavior: groundedness. Be able to change the threshold or the abstain rule during a live review and explain the tradeoff between helpfulness and hallucination.

## PR title

`Step 07: Validate grounded answers and abstain safely`
