# Step 14: Staff and admin UI

- Phase: Human support
- Depends on: 12, 13
- Status: in_review
- Spec: section 15

## Goal

Let a knowledge manager, support agent, and tenant admin complete their core tasks in the browser.

## In scope

- Navigation that reflects the caller's permissions.
- Document list, upload, ingestion status, and errors.
- Inbox, ticket detail, claim, internal note, customer reply, resolve.
- Member and role management. Audit list for permitted events.
- Playwright for: upload then see ready or a fixture ready state, and claim then resolve a ticket.
- A forbidden navigation test: a customer session does not get a working upload control. The API test from earlier steps still matters more than hiding the link.

## Out of scope

- A design system beyond accessible, consistent Tailwind components. Add shadcn/ui only for components you actually use.

## Acceptance criteria

- Internal notes are visibly separate and are not rendered on the customer page.
- Ingestion errors are readable and contain no stack traces or keys.
- Role changes made in the UI match the Step 12 rules.

## Security and deployment

Exercise the flows in the browser with two seeded users. Record what you clicked.

## Checks

Playwright flows, lint, typecheck, build, manual or automated pass of empty and error states.

## Learn in review

How you would demo the human inbox in the assessment without pretending the UI is the authorization layer.

## PR title

`Step 14: Add knowledge, inbox, and admin screens`
