# Step 13: Customer chat UI

- Phase: Human support
- Depends on: 08, 09, 11
- Status: done
- Spec: section 15

## Goal

Give a customer a usable chat surface on top of the APIs that already enforce access.

## In scope

- Conversation transcript, composer, loading and error states.
- AI answers marked as AI-generated. Citations expand to the permitted excerpt.
- Abstain and clarification copy. Button to request a human, then show real ticket status.
- Empty states.
- Accessible labels and keyboard use. Responsive layout.
- Playwright: ask a question against a mocked model or fixture retrieval, see a citation, and request a human.

## Out of scope

- Staff inbox, admin screens, visual novelty that does not serve the support task.

## Acceptance criteria

- The page uses the Step 08 API. It does not call OpenAI from the browser.
- A failed request does not look like a successful answer.
- Ticket status does not say an agent accepted it until the API says so.

## Security and deployment

Verify in the browser that secrets and other tenants' data are absent from the page source and network responses.

## Checks

Playwright path above, existing unit tests, lint, typecheck, build. Browser check of loading, error, abstain, and citation.

## Learn in review

What the UI is allowed to decide, and what stays on the server when you change copy or layout live.

## PR title

`Step 13: Add the customer chat and ticket status UI`
