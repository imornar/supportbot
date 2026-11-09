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

A role is not a superset of the others. A tenant admin can manage users, settings, and audit reads, and can read documents and tickets. An admin does not receive `order:read`. A knowledge manager does not receive order or ticket permissions. A support agent's ticket permissions do not include tenant-wide `conversation:read`. Conversation text for a ticket is loaded with that ticket, and only for a caller who can read the tenant queue. A person who needs two jobs gets two role rows. The union is `permissionsForRoles`.

There is no `ticket:create` name in the spec list. This step does not add one. A customer opens a ticket with `conversation:create`, which they already hold, and only on a private conversation they own. `POST /api/v1/tickets` accepts `customer_requested_human` only. The workflow writes the other reasons it actually decides. Priority is computed from the reason. The request body cannot set it, and there is no staff override.

## Threats this step closes

### Client-supplied tenant id

The browser can send a tenant id, and the access route reads one from the URL. Membership is loaded with both the actor id and that tenant id. A client cannot supply tenant B and pass a check that only tenant A would allow.

### Development auth left on

The flag alone does not enable the switch. Production configuration rejects the header, cookie, and query parameter. Tests cover the flag being off and production being on, including a request that also has a session. The selector page and the cookie route respond with 404 in that configuration.

### Missing permission check

`requirePermission` is the authorization step. It fails closed for an unknown permission, a non-uuid tenant id, a deactivated membership, and a role that does not include the permission. Authentication only establishes the user. The permission decision is the role rows for that tenant.

## Audit events

An audit row stores the tenant, the actor user, a short action, a target type, and a target id. There is no JSON payload column. `parseAuditEvent` rejects extra fields, so a caller cannot attach a note, token, or document body. Action and target type are limited to short machine-readable strings.

Audit rows are append-only in intent. The foreign keys use `ON DELETE RESTRICT`, so deleting a tenant or actor does not erase history. There is still no delete path for audit rows. A failed reindex may delete chunk rows for that document version. The document row stays.

## Documents

`POST /api/v1/documents` takes a tenant id in the JSON body. That id only selects which membership `requirePermission` loads. The insert uses the tenant id from the grant. Reads take `tenantId` as a query parameter and then filter `documents.tenant_id` and `document_chunks.tenant_id` in SQL. A document id from another tenant is a 404 after the caller has permission in the tenant they named.

The body is untrusted text. The server does not render it, fetch `source`, or pass it to anything except the embedding provider and the database. Chunking is a string split. Audit rows record the actor, the action, and the document id. They do not store the body, the chunk text, or the provider error. Ingestion failures persist one of: `too_large_for_sync_ingestion`, `embedding_not_configured`, `embedding_failed`, `ingestion_failed`.

`OPENAI_API_KEY` stays server-only. Preview and production do not fall back to the fake embedder. A missing key there fails the document instead of storing invented vectors.

## Retrieval

`retrieveEvidence` takes the tenant id as an argument. That id has to be the one the server already resolved from the session and the membership. The function does not accept a request body, and this step adds no route that could. The filter in the query is `document_chunks.tenant_id = <that id>`. The join requires the document's tenant to equal the chunk's tenant. It does not repeat the caller's tenant as a second parameter, so removing the chunk predicate is what lets another tenant's rows through. The cross-tenant test stores the same embedding in two tenants and expects only the caller's chunk.

Drafts, retired rows, superseded versions (`is_current = false`), failed ingestion, and documents whose effective date is still in the future are excluded in that same query. Chunk text is returned as evidence. A chunk that says to ignore tenant filters is still just text. The query does not read instructions out of it.

Top-k and the similarity threshold come from `RETRIEVAL_TOP_K` and `RETRIEVAL_SIMILARITY_THRESHOLD`. When those variables are unset, the defaults are 5 and 0.3. They are not constants inside a route handler. There is no route handler yet.

## Grounded answers

`generateGroundedAnswer` does not take a tenant id from the model. It refuses to call the provider when the evidence list is empty, larger than the retrieval cap, or split across more than one tenant. Evidence text is placed in the user message. The system message says that text cannot authorize tools or another tenant. The chat request has no tool list.

The model returns JSON. Zod rejects extra fields, including a title or section on a citation. `validateCitations` requires every `chunkId` to be in the evidence set. One unknown id drops the whole answer. The user-facing citations are built from the stored chunk, so a model-written title never replaces the document title. The response object does not include the unknown id.

A conflict flag is the model's report that the evidence disagrees. The server resolves that only when every document has an effective date and one date is strictly later, and only when every citation belongs to that later document. Otherwise the result abstains. Two documents with `conflict: false` can still be one answer. That choice prefers a supported multi-source answer over abstaining on every extra document.

A provider exception, a timeout, invalid JSON, or a missing API key becomes an abstention with a fixed sentence. The provider error message is not copied. The OpenAI client is configured with `maxRetries: 0`, and this module retries at most two times, only for timeouts, connection failures, and HTTP 408, 409, 429, and 5xx. Each attempt uses `AbortSignal.timeout`. The limit is `SUPPORTPILOT_AI_REQUEST_TIMEOUT_MS`, from 1000 to 30000, and 10000 when unset.

Token usage stays on the in-memory result. The conversation step does not write it, and it does not log the prompt or the document text.

## Support workflow

Authorization finishes before `runSupportWorkflow`. The graph context is the tenant id already on the grant, the server date, a timeout, the chat provider, and a retrieve function closed over that tenant's database client. The graph module does not import the database client or read `DATABASE_URL`.

The nodes are a fixed list: `classify`, `retrieve`, `judge`, `answer`, `clarify`, `abstain`, `escalate`, and `lookup_order`. There is no node that reads a tool name from the model. A model JSON field named `tool` on a grounded answer fails the answer schema and becomes an abstention. `lookup_order` is registered only for an authenticated customer whose grant includes `order:read`. A knowledge manager does not receive that permission, and an anonymous caller does not receive the lookup function. Those callers get a fixed refusal or a request to sign in. The lookup is not a query the model writes.

Classification is a lexical rule. "Talk to a human" cannot be reclassified by the model, because the model is not asked. The same is true for an order-number question and for a question that is only a greeting.

`retrieve` and `judge` each wait at most `SUPPORTPILOT_AI_REQUEST_TIMEOUT_MS` (10000 when unset). The LangGraph node cap is that value plus one second, and the graph recursion limit is 8. A timeout on retrieval or judgment abstains with the same fixed sentences as a provider failure. A recursion error or an unexpected graph error escalates with `workflow_failure` and a fixed sentence. None of those paths copy the provider error or the question into the stored reason.

The workflow does not register a tracing callback. A process-wide LangSmith tracer would still be able to see the question and the retrieved text, so this app does not set one.

## Order lookup

`readModelOrder` takes the tenant id and user id the server already resolved. It does not take a customer id from the model. The model may propose one numeric order number. A payload with a list, a wildcard, or any field other than `orderId` and `customerId` is not a query. When that payload is not one order number, the server uses a single order number from the question if the question contains exactly one. Several numbers, or none, return a fixed refusal and do not select a list of orders.

The SQL predicate is `orders.tenant_id` plus `customers.user_id` for the session. The select list is the order id, order number, status, placed-on date, and summary. `internal_notes` and `payment_instrument` are real columns. They are not in that select, and they are not in the response schema. A miss, another customer's order in the same tenant, and an order number that exists only in another tenant all return the same refusal. The server does not query another tenant to tell those cases apart. Another customer in the same tenant writes `order.lookup.refused` with the order id as the target. An order number that is not in the caller's tenant writes the same action with the caller's customer id as the target. The audit row has no payload. The lookup does not insert, update, or delete orders.

A logged-out question never calls this function. The assistant message asks the person to sign in.

## Conversations

`POST /api/v1/support/messages` is the customer question route. The JSON body may contain `question` and, for a signed-in customer, `conversationId`. It may not contain a tenant id, a user id, an order id, a tool name, or a history array. Zod rejects those fields. The idempotency key is the `Idempotency-Key` header, and it has to be a UUID.

A signed-in caller passes `tenantId` as a query parameter. That value only selects which membership `requirePermission` loads. The insert uses the tenant id on the grant. The permission is `conversation:create` for a new message and `conversation:read` for history. A customer can list and read private conversations whose `customer_user_id` is their user id. Another customer's id is a 404. A support agent does not have `conversation:read` on this route. Ticket context is a later step.

A logged-out caller cannot pass `tenantId` or `conversationId`. The tenant is the row whose slug is `SUPPORTPILOT_PUBLIC_TENANT_SLUG`. Local seed data uses `harbor` (Harbor Goods). If the variable is unset or the slug does not match a tenant, the route returns `public_tenant_unavailable`. The handler stores that conversation with `is_private = false` and a null customer. An order question on that logged-out path asks the person to sign in and does not query orders. `GET /api/v1/conversations` without a session is 401. A non-private conversation can be read by its id without a session. The id is the secret. Private rows stay hidden from that read.

The message table is the product record. An assistant row stores the workflow outcome (`answered`, `clarified`, `abstained`, or `escalated`), the citation check (`passed`, `failed`, or `not_applicable`), the model id, a short reason code, the intent, and an escalation reason when the outcome is `escalated`. Citations stored on an answered message are the validated excerpts copied from retrieved chunks. The raw provider payload and token usage are not columns. A signed-in escalation also opens a ticket. The assistant sentence is fixed at that moment and still says a person has not accepted. Claim does not rewrite it. `audit_events` still has no payload. A signed-in answer also writes `conversation.answer` with the actor and the conversation id. A logged-out answer has no actor, so it does not write an audit event, and it does not open a ticket. The message row is the record.

The rate limit is `support_rate_buckets`. The key is `user:<tenant>:<user>` or `public:<tenant>:<sha256 of the client address>`. The window is one database minute. `SUPPORTPILOT_RATE_LIMIT_PER_MINUTE` defaults to 60. A replay of a completed idempotency key does not take another slot. The counter is not a process-local map.

A repeated idempotency key for the same customer, or for the logged-out demo in that public tenant, returns the original two messages and, when that turn opened a ticket, the same ticket id with the ticket's current status. The key is not checked against a new question. A public idempotency key is a bearer token for that public answer. Clients should use a fresh UUID per submit.

## Tickets

`POST /api/v1/tickets` takes `tenantId` as a query parameter and `conversationId` plus `reason` in the body. The reason has to be `customer_requested_human`. A `priority` field is rejected. The handler loads `conversation:create` for that tenant, then inserts only when the conversation is private and `customer_user_id` is the actor. Another customer's conversation is a 404. A second open ticket for the same conversation and reason returns the existing row. `open`, `assigned`, `in_progress`, and `reopened` all count as open for that unique index. `resolved` does not. `closed` is in the enum and has no transition.

Claim, reply, resolve, and reopen require `ticket:claim`, `ticket:reply`, and `ticket:resolve` in that tenant. Resolve and a customer-visible reply require the caller to be the current assignee. Another agent receives `illegal_transition` or `ticket_held`. Reopen requires `ticket:resolve` and does not require the old assignee, because a resolved ticket is not held. Reopen clears the assignee. The next claim sets a new one and clears `resolved_at`.

Customer and queue reads select `ticket_messages.visibility = 'customer'` only. An agent with `ticket:reply` also selects `internal` rows, and those are returned as `notes`. The customer JSON schema has no `notes` field. `loadTicketModelContext` uses the same customer-only filter. It builds text from the reason, the status, the conversation, and customer-visible replies. Note text is not a parameter of that function.

A signed-in workflow escalation calls the same insert. The customer sentence remains "A support agent has not accepted this yet." Claim does not change that sentence. Ticket status is the live signal that a person holds it.

Ticket audit actions are `ticket.create`, `ticket.claim`, `ticket.reply`, `ticket.note`, `ticket.resolve`, and `ticket.reopen`. They do not store the reply body.

## Retention

Conversations and tickets are not stored yet. Document text is.

What this schema stores, and how long it is meant to live:

- Tenants, users, memberships, and role assignments stay until an operator deactivates the membership or a later step defines deletion. Deactivation is a status. This step does not delete users to remove access.
- Audit events are kept for the life of the tenant record. They are not a place to store message text, document text, or secrets.
- Document rows and chunks stay when a version is superseded or retired. Retirement and supersession clear `is_current`. They do not delete the text or the audit row. A failed reindex deletes that version's chunk rows so a failed document has no vectors. The source text remains, and a later reindex can rebuild the chunks.
- Do not log document bodies or embedding errors. Provider exceptions can echo the input.
- Conversations and messages stay with the tenant. Deactivating a membership does not delete them. This step does not expire or purge them. Do not log message bodies by default. Rate-limit buckets older than two minutes are deleted by the limiter.
- Tickets and ticket messages stay with the tenant. Resolving a ticket does not delete it. Deactivating a membership does not delete it. Do not log reply bodies or staff notes by default. Audit rows for ticket actions store the actor and the ticket id, not the note.
- Customer and order rows stay with the tenant. Order lookup does not delete them. Do not log internal notes, payment instrument values, or the lookup response by default.

Development seed data uses fixed example identities and no passwords. `npm run db:seed` refuses `NODE_ENV=production`, any Vercel runtime, and Vercel preview or production. The seed is not a migration and must not be pointed at a production database.
