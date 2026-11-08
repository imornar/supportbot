# Security

This file records boundaries that are already in the schema. Authentication and permission enforcement arrive in Step 04. Until then, these tables are not exposed by a route.

## Tenant identity

A client-supplied tenant id is never proof of membership. Later steps derive the tenant from the verified session, then pass that server-side id into a query helper. Helpers in `src/server/db/tenant-queries.ts` require a tenant id argument and filter in SQL.

Resource ids (a membership id, a user id, an audit event id) may be accepted from a client only after a query has shown that the row belongs to the session tenant. The tenant id itself is not that proof.

`users` are global identity records. They have no tenant id and no password column. Tenant ownership starts at `tenant_memberships`. `role_assignments.tenant_id` must match the membership's tenant. The composite foreign key rejects a role in one tenant for a membership in another. A person can belong to two tenants, with different roles, as two membership rows.

## Why Row Level Security is deferred

Application queries filter by tenant even if the database also has policies. Policies are not a substitute for that filter.

Row Level Security is off in this step. The app uses one shared `pg` pool. On Vercel that pool has a maximum of one connection, and Neon's pooled hostname is a transaction-mode pooler. A session variable such as `SET app.tenant_id` would stick to the pooled connection and can be read by the next request that reuses it. `SET LOCAL` lasts only for the current transaction, which is safe only when every tenant-scoped statement runs inside one explicit transaction that sets the variable first.

Using session variables for policies would require all of the following:

- Every tenant-scoped statement runs inside a single transaction that starts with `SET LOCAL`.
- The pooler is in transaction or session mode and does not hand the same server connection to another client mid-transaction.
- The table owner does not bypass policies. PostgreSQL lets the owner skip RLS unless `FORCE ROW LEVEL SECURITY` is set, and the migration role owns these tables.
- A missing `SET LOCAL` fails closed, rather than returning every row.

None of that is wired up. The pool stays a normal pooled client. Tenant filters stay in the query.

## Permissions

Permission names live in `src/server/auth/permissions.ts`. They match spec section 6. Nothing checks them yet.

A role is not a superset of the others. A tenant admin can manage users, settings, and audit reads, and can read documents and tickets. An admin does not receive `order:read`. A knowledge manager does not receive order or ticket permissions. A support agent's ticket permissions do not include tenant-wide `conversation:read`. Conversation context for a ticket will be authorized with the ticket, in the ticket step. A person who needs two jobs gets two role rows. The union is `permissionsForRoles`.

There is no `ticket:create` name in the spec list. Customer ticket creation will need an explicit decision when tickets exist. This step does not invent that permission.

## Audit events

An audit row stores the tenant, the actor user, a short action, a target type, and a target id. There is no JSON payload column. `parseAuditEvent` rejects extra fields, so a caller cannot attach a note, token, or document body. Action and target type are limited to short machine-readable strings.

Audit rows are append-only in intent. The foreign keys use `ON DELETE RESTRICT`, so deleting a tenant or actor does not erase history. This step has no delete path.

## Retention

No customer content, conversation, ticket, or document body exists yet.

What this schema stores, and how long it is meant to live:

- Tenants, users, memberships, and role assignments stay until an operator deactivates the membership or a later step defines deletion. Deactivation is a status. This step does not delete users to remove access.
- Audit events are kept for the life of the tenant record. They are not a place to store message text, document text, or secrets.
- Conversations, tickets, and uploads are not in this migration. When they arrive, they need their own retention notes. The expectation to carry forward is: keep them with the tenant, do not log their contents by default, and do not delete them as a side effect of a membership change.

Development seed data uses fixed example identities and no passwords. `npm run db:seed` refuses `NODE_ENV=production`, any Vercel runtime, and Vercel preview or production. The seed is not a migration and must not be pointed at a production database.
