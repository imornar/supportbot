# Step 04: Authentication and permissions

- Phase: Foundation
- Depends on: 03
- Status: not_started
- Spec: sections 6, 7, 8, 20

## Goal

Turn a verified identity into a tenant-scoped permission check. Keep the development identity switch impossible in production.

## In scope

- Auth.js, as accepted in ADR 0001.
- Map the provider subject to `users` and memberships on the server.
- `requirePermission(permission)` used by route handlers. UI checks may call the same rules for display, but tests cover the server.
- Development identity selector behind an explicit env flag. Requests that send the dev header, cookie, or query param are rejected when the flag is off or when `NODE_ENV` / Vercel production is active. Test both.
- Seeded dev identities from Step 03.
- `docs/security.md` section for the threat: client-supplied tenant id, dev auth left on, missing permission check.

## Out of scope

- Invites by email, SSO configuration beyond what Auth.js needs for one provider, document upload.

## Acceptance criteria

- An authenticated member can pass a permission they hold and fails one they do not.
- A user in tenant A cannot pass a check for a tenant B resource.
- Production configuration cannot select a development identity. Add a test that fails if the shortcut is reachable.
- No custom password hashes.

## Security and deployment

Document the Auth.js secrets in `.env.example`. Preview deployments use preview secrets and the preview database.

## Checks

Permission unit tests, dev-auth rejection test, lint, typecheck, build. Manual login can be documented if a provider console is required. Do not claim manual login was done unless it was.

## Learn in review

The difference between authentication and authorization, and where you would change a permission live during the assessment without touching the model.

## PR title

`Step 04: Add Auth.js sessions and permission checks`
