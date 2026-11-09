# Step 12: Staff and admin operations

- Phase: Human support
- Depends on: 05, 11
- Status: in_review
- Spec: sections 6, 9.2, 14

## Goal

Expose the staff operations that are still missing from the APIs: document lifecycle, queue filters, and tenant membership management.

## In scope

- Document list, detail, reindex, retire, already authorized.
- Ticket list filters by status and priority inside the caller's tenant.
- Tenant admin: list members, assign and revoke roles, deactivate membership. An admin of tenant A cannot edit tenant B. Test it.
- Last admin cannot remove their own admin role, or document another safeguard you implement.
- Settings that are actually used, even if the first setting is only the public support name. Do not add a settings framework with no readers.
- Audit events for role changes and document retirement.

## Out of scope

- Visual design. JSON or server actions are enough. Screens are Steps 13 and 14.

## Acceptance criteria

- Each route names its permission and has a forbidden test.
- Deactivated members fail the next permission check.
- Reindex uses the same ingestion path as upload.

## Security and deployment

Admin is tenant-scoped. There is no hidden superuser in the client bundle.

## Checks

Permission tests for every new route, lint, typecheck, build.

## Learn in review

How role changes take effect, and why a support agent is not a tenant admin.

## PR title

`Step 12: Add staff document, queue, and membership APIs`
