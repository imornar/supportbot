# Step 03: Tenant, membership, and audit schema

- Phase: Foundation
- Depends on: 02
- Status: done
- Spec: sections 6, 8, 13

## Goal

Create the ownership model every later table must follow: tenant, user reference, membership, role, and audit event.

## In scope

- Tables: `tenants`, `users`, `tenant_memberships`, `role_assignments`, `audit_events`.
- UUID primary keys, foreign keys, timestamps, and uniqueness constraints that stop duplicate memberships.
- Seed data for two tenants and users with different roles, for development only.
- Query helpers that require a tenant id argument. A test proves a query for tenant A cannot return tenant B rows.
- Document retention expectations as comments or a short section in `docs/security.md`. No customer content exists yet.
- Permission names from the spec, stored or mapped in one module, even if enforcement waits for Step 04.

## Out of scope

- Login, sessions, and the development identity switch.
- Documents, conversations, orders, tickets.

## Acceptance criteria

- Migrations apply on an empty database and again with no further changes.
- Cross-tenant test fails if the tenant filter is removed.
- Seeded passwords are not stored. Users are identity records, not a homemade password system.
- Audit event shape can record actor, tenant, action, and target without a free-form secret payload.

## Security and deployment

Application-level tenant filters are mandatory. Note why Row Level Security is deferred and what would have to be true about the pool before using session variables.

## Checks

Migration test, tenant-isolation test, lint, typecheck, build.

## Learn in review

Where tenant isolation lives in the schema, and which identifiers are safe to accept from a client later (resource ids only after an ownership check, never a tenant id as proof).

## PR title

`Step 03: Add tenant membership and audit schema`
