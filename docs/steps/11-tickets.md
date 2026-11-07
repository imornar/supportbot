# Step 11: Tickets and escalation

- Phase: Human support
- Depends on: 08, 09
- Status: not_started
- Spec: sections 9.3, 9.4, 12, 20

## Goal

When the workflow or the customer asks for a human, create one ticket and move it through a small status machine.

## In scope

- Tables: `tickets`, `ticket_messages`. Statuses and escalation reasons from the spec.
- Create from the workflow decision or `POST /api/v1/tickets`. Idempotent per conversation and open reason so a retry does not duplicate.
- Claim, reply, resolve, reopen. Staff-only notes stored separately from customer-visible replies.
- Customer APIs never return internal notes. Add a test that loads a ticket as the customer and fails if a note field appears.
- Audit events for create, claim, reply, resolve.
- The customer message must not say an agent has accepted the ticket until claim succeeds.
- API tests for a second tenant and a customer who is not the requester.

## Out of scope

- Inbox UI, email, SMS, external helpdesk.

## Acceptance criteria

- Illegal transitions fail, for example resolve from a ticket the agent does not hold, according to the rules you document.
- Internal note text is absent from customer JSON and from the context built for a later model call.
- Ticket creation still works when the model call failed, if the user explicitly asked for a human.

## Security and deployment

Claim and reply require support-agent permissions in that tenant. Priority is server-assigned from the escalation reason, not an unchecked client field, unless you document a staff-only override.

## Checks

State-machine tests, authorization tests, note-leak test, lint, typecheck, build.

## Learn in review

Where the human enters the system, and which promises the product must not make before a person acts.

## PR title

`Step 11: Add the support ticket lifecycle`
