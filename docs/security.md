# Security

This file records the tenant boundary, the Auth.js session, and the permission check. The model is not part of this step.

## Tenant identity

A client-supplied tenant id is never proof of membership. The server derives the actor from a verified Auth.js session, or from the development identity switch when that switch is explicitly enabled. `requirePermission` then loads the active membership for the resource tenant. Helpers in `src/server/db/tenant-queries.ts` still require a tenant id argument and filter in SQL.

`GET /api/tenants/:tenantId/access?permission=` takes the tenant id from the path. That value selects which membership to check. It does not grant access. A member of tenant A fails the check for a tenant B resource even when they hold the same permission in A.

Resource ids (a membership id, a user id, an audit event id) may be accepted from a client only after a query has shown that the row belongs to the session tenant. The tenant id itself is not that proof.

`users` are global identity records. They have no tenant id and no password column. `auth_provider` and `auth_subject` store the GitHub account id after a verified link. Both stay null until that link. Tenant ownership starts at `tenant_memberships`. `role_assignments.tenant_id` must match the membership's tenant. The composite foreign key rejects a role in one tenant for a membership in another. A person can belong to two tenants, with different roles, as two membership rows.

## Why Row Level Security is deferred

Application queries filter by tenant even if the database also has policies. Policies are not a substitute for that filter.

Row Level Security is off in this step. The app uses one shared `pg` pool. On Vercel that pool has a maximum of one connection, and Neon's pooled hostname is a transaction-mode pooler. A session variable such as `SET app.tenant_id` would stick to the pooled connection and can be read by the next request that reuses it. `SET LOCAL` lasts only for the current transaction, which is safe only when every tenant-scoped statement runs inside one explicit transaction that sets the variable first.

Using session variables for policies would require all of the following:

- Every tenant-scoped statement runs inside a single transaction that starts with `SET LOCAL`.
- The pooler is in transaction or session mode and does not hand the same server connection to another client mid-transaction.
- The table owner does not bypass policies. PostgreSQL lets the owner skip RLS unless `FORCE ROW LEVEL SECURITY` is set, and the migration role owns these tables.
- A missing `SET LOCAL` fails closed, rather than returning every row.

None of that is wired up. The pool stays a normal pooled client. Tenant filters stay in the query.

## Authentication

Production identity is an Auth.js JWT session from the GitHub provider. The token stores `authProvider` and `authSubject`. It does not store permissions, the GitHub access token, or an email. There is no Credentials provider and no password hash.

On sign-in the server looks up `users` by that subject. The first time, it attaches the subject to an existing user whose email matches GitHub's primary verified email and whose subject columns are still empty. A second subject cannot take that email. Unknown people are refused. Invites are a later step, so a GitHub login does nothing until a user row exists.

`AUTH_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET` are server environment variables. Preview and production use different secrets and the preview database. On Vercel, leave `AUTH_URL` unset so each deployment uses its own host. Local development sets `AUTH_URL` to the local origin.

Changing what a person can do is a change to `role_assignments` for their membership. The next request loads those roles again. The session does not cache the permission list, and the model is not involved.

## Development identity

`/dev/identity` is a local switch over the seeded users from Step 03. It is not authentication. It sets an httpOnly cookie named `supportpilot-dev-user`. The same user id is also read from the `x-supportpilot-dev-user` header and the `devUser` query parameter.

The switch runs only when `SUPPORTPILOT_ALLOW_DEV_IDENTITY` is the exact string `true` and the process is not in production configuration. Production configuration means `NODE_ENV=production` or `VERCEL_ENV=production`. Vercel preview sets `NODE_ENV=production`, so the switch is off there too. A request that sends any of the three signals is rejected when the switch is off, including when a real session is also present. The accepted value has to be one seeded user id. Disagreeing signals are rejected.

## Permissions

Permission names live in `src/server/auth/permissions.ts`. They match spec section 6. `requirePermission(permission)` is the server check. The access route calls it before it reports a grant. UI may use the same role map for display. Hiding a control is not the check. A route that returns tenant data has to call `requirePermission` itself.

A missing membership, a deactivated membership, or a missing permission is the same forbidden result. The response does not say which one failed.

A role is not a superset of the others. A tenant admin can manage users, settings, and audit reads, and can read documents and tickets. An admin does not receive `order:read`. A knowledge manager does not receive order or ticket permissions. A support agent's ticket permissions do not include tenant-wide `conversation:read`. Conversation context for a ticket will be authorized with the ticket, in the ticket step. A person who needs two jobs gets two role rows. The union is `permissionsForRoles`.

There is no `ticket:create` name in the spec list. Customer ticket creation will need an explicit decision when tickets exist. This step does not invent that permission.

## Threats this step closes

### Client-supplied tenant id

The browser can send a tenant id, and the access route reads one from the URL. Membership is loaded with both the actor id and that tenant id. A client cannot supply tenant B and pass a check that only tenant A would allow.

### Development auth left on

The flag alone does not enable the switch. Production configuration rejects the header, cookie, and query parameter. Tests cover the flag being off and production being on, including a request that also has a session. The selector page and the cookie route respond with 404 in that configuration.

### Missing permission check

`requirePermission` is the authorization step. It fails closed for an unknown permission, a non-uuid tenant id, a deactivated membership, and a role that does not include the permission. Authentication only establishes the user. The permission decision is the role rows for that tenant.

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
