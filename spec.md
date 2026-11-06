# SupportPilot — Project Specification

**Document status:** Initial project specification
**Project type:** AI-powered customer support platform
**Primary goal:** Build a production-minded, cloud-deployable proof of concept demonstrating AI engineering, RAG, agent workflows, security, evaluation, and system design.

---

## 1. Project Overview

SupportPilot is a multi-tenant AI customer support application.

Customers interact with an AI assistant that answers questions using approved company documentation. The assistant can retrieve authorized order information, identify when it cannot safely answer, and escalate conversations to human support agents.

Company staff manage knowledge-base documents, support tickets, and workspace configuration through a simple web interface.

The application must run locally for development and be deployable to Vercel and managed cloud services. Production must not depend on local disk persistence, local-only services, or developer credentials.

The project should demonstrate the ability to design and build an AI-enabled system, make explicit architectural trade-offs, evaluate model quality, enforce security boundaries, and explain the design during a technical review.

## 2. Product Goals

The application must:

1. Answer customer questions using company-approved knowledge.
2. Provide citations for answers based on retrieved documents.
3. Abstain or escalate when evidence is insufficient, conflicting, or unsafe.
4. Support tenant isolation at the data, retrieval, API, and authorization layers.
5. Allow authorized staff to upload, update, and retire knowledge-base documents.
6. Allow customers to request human support.
7. Provide a human support inbox with ticket assignment and resolution.
8. Demonstrate secure access to customer-specific order information.
9. Measure answer quality, retrieval quality, latency, errors, and approximate AI costs.
10. Deploy as a working cloud application with a minimal, usable web interface.

## 3. Non-Goals

The initial release does not need:

- A fully autonomous agent capable of arbitrary actions.
- Real payment processing, refunds, or irreversible account modifications.
- A complex enterprise identity-management system.
- A sophisticated real-time chat platform.
- A complete CRM or helpdesk replacement.
- A custom-trained foundation model.
- Kubernetes or microservices infrastructure.

Prefer a controlled, observable workflow with narrowly scoped tools over an unrestricted autonomous agent.

## 4. Technology Stack

Use a TypeScript-first, serverless-friendly architecture.

### Frontend and application backend

- **Next.js** with the App Router.
- **TypeScript** with strict type checking.
- **React** for the user interface.
- Next.js Route Handlers and/or Server Actions for backend operations where appropriate.
- Zod for request and form validation.
- Tailwind CSS for styling.
- A reusable accessible component library, such as shadcn/ui, if useful.

The initial application should be a single Next.js codebase deployed to Vercel. Do not introduce a separate Python FastAPI service unless a specific technical requirement justifies it.

### AI and orchestration

- OpenAI API for embeddings and language-model calls.
- Official OpenAI TypeScript SDK.
- LangGraph.js for multi-step AI orchestration when its capabilities materially help the workflow.
- Zod or equivalent runtime schemas for structured model output.
- Explicit timeouts, bounded retries, and model configuration.

Keep provider-specific code behind application interfaces so model providers can be changed without rewriting business logic.

Do not use an agent framework merely to wrap a simple prompt. Use LangGraph for meaningful branching, state transitions, tool execution, and escalation decisions.

### Database and persistence

- Managed PostgreSQL with `pgvector`.
- A managed database provider compatible with the selected production deployment, such as Neon or Supabase PostgreSQL.
- Drizzle ORM with migrations, or another well-justified TypeScript-compatible ORM.
- PostgreSQL full-text search or hybrid search if it improves retrieval quality.

The selected provider must support the required PostgreSQL extensions, connection strategy, and production access patterns.

Use a pooled connection strategy appropriate for Vercel's serverless environment. Avoid exhausting the database connection limit through per-request connections.

### Development and deployment

- Vercel for the Next.js application.
- Managed PostgreSQL for persistent application data.
- GitHub for source control.
- GitHub Actions for CI.
- Vitest for unit and integration tests.
- Playwright for critical browser workflows.
- ESLint and Prettier, or a justified equivalent.
- Docker Compose for local PostgreSQL development only, if the chosen image supports `pgvector`.

Pin dependencies through a lockfile. Prefer the current stable Node.js LTS supported by the chosen Next.js version and Vercel.

Do not require a Python backend for the initial release.

## 5. Deployment and Runtime Requirements

Production deployment is a first-class requirement, not a final optional task.

The architecture and implementation must account for Vercel's serverless execution model from the beginning.

### Production requirements

- All application state that must survive a request or deployment lives in managed persistent services.
- Never use local files as the permanent store for uploaded documents, generated files, or application records.
- Store document content in PostgreSQL or object storage if object storage is introduced.
- Store secrets in Vercel environment variables or the relevant provider's secret manager.
- Never expose API keys, database credentials, privileged service keys, or internal authorization data to the browser.
- Use server-side authorization for every protected operation.
- Keep database queries and AI operations within supported execution time limits.
- Use request timeouts and bounded retries.
- Ensure repeated requests cannot accidentally create duplicate tickets or duplicate ingestion jobs when idempotency is required.
- Use a production-safe connection pool.
- Avoid relying on in-memory application state for sessions, locks, rate limits, job queues, or shared caches.
- Use managed durable job processing if document ingestion or other operations exceed request execution limits.
- Implement health/readiness checks appropriate to the deployment environment.
- Separate development, preview, and production configuration.
- Document database migration and rollback procedures.
- Make database migrations explicit and repeatable; never automatically run destructive migrations on every application startup.
- Ensure preview deployments cannot accidentally access or modify production data.

### Environment configuration

Provide `.env.example` with placeholder values and documentation for at least:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- Authentication provider configuration.
- Application base URL.
- Development identity configuration, if applicable.
- Rate-limit and AI request limits.
- Optional observability configuration.

Use server-only environment variables for all secrets. Do not prefix secrets with `NEXT_PUBLIC_`.

Validate required environment variables at startup or during server initialization, with clear errors that never reveal secret values.

### Deployment environments

**Local development**
- Next.js application.
- Local PostgreSQL with `pgvector`, preferably through Docker Compose.
- Local environment variables.
- Seeded development users and sample documents.

**Preview**
- Vercel preview deployment.
- Isolated preview database or a dedicated non-production database/schema with appropriate isolation.
- Non-production API keys and data.
- No automatic access to production customer data.

**Production**
- Vercel production deployment.
- Managed PostgreSQL with `pgvector`.
- Production authentication and secrets.
- Production database migrations.
- Configured logging, error monitoring, and usage limits.
- Documented backup and recovery arrangements.

The project is not considered production-ready merely because a Vercel build succeeds. Critical flows must also work against deployed services.

## 6. User Roles and Permissions

Implement a multi-tenant authorization model with four primary roles.

### 6.1 Customer

Customers can:

- Ask general support questions.
- View their own conversation history.
- Access their own orders after authentication and authorization.
- Create a support ticket or request human assistance.
- View permitted updates to their own tickets.

Customers cannot:

- View another customer's orders or conversations.
- Upload or manage knowledge-base documents.
- Access staff-only notes.
- Assign or resolve tickets as support staff.
- Manage tenant configuration.

General public questions may be answered without a login. Private data always requires verified identity and authorization.

### 6.2 Knowledge Manager

Knowledge Managers can:

- Upload supported knowledge documents.
- View document ingestion status and errors.
- Update document metadata and content.
- Publish, supersede, or retire documents.
- Review document versions and ingestion history.

They cannot automatically access private orders or unrestricted customer data.

### 6.3 Support Agent

Support Agents can:

- View tickets within their authorized tenant and permitted queue.
- Claim or accept tickets.
- View the conversation context associated with an authorized ticket.
- Add internal notes.
- Reply to customers.
- Resolve or reopen tickets.
- Escalate tickets to another authorized queue or supervisor.

They cannot manage users or change tenant-wide security configuration unless separately granted an administrative role.

### 6.4 Tenant Admin

Tenant Admins can:

- Invite users and deactivate tenant memberships.
- Assign and revoke roles within their tenant.
- Configure tenant-level settings.
- Oversee documents and tickets.
- View permitted audit events.

Administrative privileges must be scoped to the relevant tenant. An admin must not automatically gain unrestricted cross-tenant access.

### Role model

A user may hold multiple roles in one tenant. Keep role assignments and tenant memberships explicit.

Enforce permissions on the server, not just in the UI. Hiding a button is not authorization.

Use a centralized authorization layer with explicit permission checks, such as:

- `conversation:read`
- `conversation:create`
- `order:read`
- `document:read`
- `document:create`
- `document:update`
- `document:retire`
- `ticket:read`
- `ticket:claim`
- `ticket:reply`
- `ticket:resolve`
- `tenant:user:manage`
- `tenant:settings:manage`
- `audit:read`

The final permission mapping should be documented and tested.

## 7. Authentication and Development Identity

Use a real authentication provider for production. Select and document a provider compatible with Next.js and Vercel, such as Auth.js or a managed identity provider.

Do not implement custom password storage or roll your own production authentication system.

For early development, seeded test identities and a clearly isolated development-only identity selector are acceptable.

Development identity selection must be impossible to enable accidentally in production. The server must reject development identity headers, query parameters, or cookies when production configuration is active.

A development identity selector is not real authentication. Document this limitation explicitly.

Production identity must come from a verified session or token. Map verified identities to tenant memberships and roles on the server.

## 8. Multi-Tenant Isolation and Security

All tenant-owned records must have an explicit tenant association or an unambiguous ownership path.

Tenant boundaries apply to:

- Users and memberships.
- Documents and chunks.
- Embeddings and retrieval results.
- Conversations and messages.
- Customers and orders.
- Tickets and internal notes.
- Audit events and operational metadata.

### Mandatory rules

1. Never trust a client-supplied tenant ID as proof of membership.
2. Derive tenant context from verified identity and server-side membership checks.
3. Enforce tenant filtering in database queries and retrieval operations.
4. Check resource ownership before returning or modifying records.
5. Validate tool arguments and model-generated structured output.
6. Never give the language model direct, unrestricted database access.
7. Do not rely on prompt instructions as a security boundary.
8. Treat uploaded documents and retrieved content as untrusted input.
9. Never include unauthorized data in model context.
10. Redact secrets and unnecessary personal data from logs.
11. Rate-limit sensitive and expensive endpoints.
12. Apply upload limits and validate file content.
13. Record important administrative and support actions in an audit log.

Consider PostgreSQL Row-Level Security if it can be implemented reliably with the chosen connection-pooling strategy. Application-level authorization and tenant-scoped queries remain mandatory regardless.

Document and test the consequences of connection pooling, transaction boundaries, and any session variables used for database policies.

## 9. Core User Workflows

### 9.1 Customer asks a question

1. The customer submits a question.
2. The server validates the request and applies rate limits.
3. The server resolves the permitted tenant context.
4. The AI workflow classifies the request.
5. The retrieval service searches only documents available to that tenant.
6. Retrieved evidence is evaluated for relevance, freshness, and conflicts.
7. The model generates a structured answer.
8. The server validates the answer and its citation references.
9. The response includes citations or an explanation that the system cannot confidently answer.
10. The conversation and relevant audit metadata are persisted.

### 9.2 Knowledge Manager uploads a document

1. Verify the user's identity, tenant membership, and permission.
2. Validate file type, size, and content.
3. Store the document and metadata persistently.
4. Record uploader, version, checksum, tenant, and ingestion status.
5. Extract text and divide it into useful chunks.
6. Generate embeddings using the configured provider.
7. Store chunks and vectors with tenant and source metadata.
8. Mark the document ready only after indexing succeeds.
9. Report ingestion failures without exposing secrets.
10. Keep prior versions and retirement metadata according to the documented lifecycle.

Initial supported formats should be Markdown and plain text. Add PDF or other formats only after the core pipeline is reliable.

For longer ingestion tasks, use a durable background-job mechanism compatible with Vercel rather than relying on an HTTP request remaining alive indefinitely.

### 9.3 Customer requests human support

1. The AI identifies a situation requiring human assistance, or the customer explicitly requests a human.
2. The server creates a ticket and associates it with the authorized conversation and customer.
3. The ticket records its reason, status, priority, timestamps, and relevant evidence references.
4. The customer receives a confirmation that the request is awaiting support.
5. An authorized Support Agent sees the ticket in the inbox.
6. The agent claims or accepts the ticket.
7. The agent reviews the conversation and responds.
8. The ticket is resolved, reopened, or further escalated as appropriate.

Never tell a customer that a human has accepted the ticket until an authorized agent actually does so.

### 9.4 Support Agent responds

Support Agents must be able to review the conversation, see the escalation reason, add internal notes, send customer-facing replies, and update ticket status.

Internal notes must never be returned to customers or included in customer-facing model context unless explicitly and safely transformed.

## 10. Knowledge Base and Retrieval-Augmented Generation

Implement RAG rather than fine-tuning for company-specific support knowledge.

### Document metadata

At minimum, persist:

- Document ID.
- Tenant ID.
- Title and source.
- Document type.
- Version.
- Status.
- Creation and update timestamps.
- Uploader identity.
- Effective date, if applicable.
- Content checksum.
- Ingestion status and failure reason.
- Retirement or supersession metadata.

### Chunk metadata

At minimum, persist:

- Chunk ID.
- Tenant ID.
- Document ID and version.
- Chunk text.
- Embedding.
- Source location or section.
- Relevant metadata for filtering.

### Retrieval requirements

- Tenant-scoped retrieval.
- Configurable top-k results.
- Similarity threshold or equivalent relevance filtering.
- Citation metadata.
- Version and retirement filtering.
- Freshness handling where applicable.
- Optional hybrid lexical/vector retrieval if evaluation demonstrates a benefit.

### Citations

Citations must refer to real retrieved evidence.

The model must not invent document IDs, URLs, section names, or citations. Validate generated citation references against the evidence supplied to the model.

The UI should make it possible to inspect the cited source and relevant excerpt when the user has permission to see it.

### Conflicting information

When retrieved documents disagree:

1. Apply explicit source precedence and effective-date rules where available.
2. Prefer the currently published, authoritative version.
3. Do not silently choose an answer when the conflict cannot be resolved.
4. Abstain or escalate when necessary.
5. Record conflict metadata for evaluation and troubleshooting.

### Insufficient evidence

If the system cannot retrieve sufficient evidence, it must not invent a confident answer.

It should provide a brief explanation, ask a clarifying question when useful, or offer escalation to a human.

## 11. AI Workflow and Tool Design

Use a controlled workflow with explicit state transitions.

Suggested flow:

1. Validate input.
2. Resolve tenant, user, and authorization context.
3. Classify intent.
4. Select an allowed workflow.
5. Retrieve relevant knowledge or call an authorized business tool.
6. Evaluate evidence sufficiency and conflicts.
7. Generate a structured response.
8. Validate citations and output schema.
9. Decide whether to answer, clarify, abstain, or escalate.
10. Persist the result and relevant evaluation metadata.

Use LangGraph.js if its state management and branching materially improve this implementation. Keep nodes small, typed, testable, and observable.

Do not permit unrestricted tool selection or arbitrary SQL generated by the model.

### Order lookup

Order lookup is a narrowly scoped server-side tool.

- Requires an authenticated customer.
- Derives customer identity from verified server-side context.
- Verifies order ownership in the database.
- Returns only the fields needed to answer the question.
- Never trusts a customer ID supplied in model output.
- Must not modify orders or initiate refunds in the initial release.

## 12. Human Escalation and Ticket Lifecycle

Implement a small but complete ticket workflow.

Suggested statuses:

- `open`
- `assigned`
- `in_progress`
- `resolved`
- `reopened`
- `closed`

Suggested escalation reasons:

- Customer requested a human.
- Insufficient evidence.
- Conflicting knowledge sources.
- Repeated unsuccessful attempts.
- Sensitive or high-risk request.
- Business tool unavailable.
- Model or workflow failure.

Tickets should include:

- Ticket ID.
- Tenant ID.
- Customer and conversation references.
- Reason and priority.
- Status.
- Assigned agent, if any.
- Created, updated, claimed, and resolved timestamps.
- Customer-visible replies.
- Staff-only notes.
- Relevant source citations and escalation metadata.

The initial release does not require external email, SMS, or third-party helpdesk integration.

## 13. Data Model

Design migrations for the following core entities. Adjust exact schemas based on implementation needs and document decisions.

- `tenants`
- `users` or external identity references
- `tenant_memberships`
- `role_assignments` or an equivalent normalized permission model
- `customers`
- `documents`
- `document_chunks`
- `conversations`
- `messages`
- `orders`
- `tickets`
- `ticket_messages`
- `audit_events`

Use UUIDs or another appropriate non-guessable identifier for externally referenced records.

Use foreign keys, appropriate uniqueness constraints, timestamps, and indexes. Define deletion and retention behavior explicitly.

Keep tenant ownership enforceable by database constraints and server-side logic.

Avoid unnecessary personal data. Document retention and deletion behavior for conversations, tickets, and uploaded content.

## 14. API and Application Boundaries

Use Next.js Route Handlers or Server Actions for application operations. Keep business logic out of UI components.

Suggested endpoint families:

- `GET /api/health`
- `GET /api/ready`
- `POST /api/v1/support/messages`
- `GET /api/v1/conversations`
- `GET /api/v1/conversations/:id`
- `POST /api/v1/documents`
- `GET /api/v1/documents`
- `GET /api/v1/documents/:id`
- `POST /api/v1/documents/:id/reindex`
- `POST /api/v1/tickets`
- `GET /api/v1/tickets`
- `GET /api/v1/tickets/:id`
- `POST /api/v1/tickets/:id/claim`
- `POST /api/v1/tickets/:id/replies`
- `POST /api/v1/tickets/:id/resolve`
- Administrative user and tenant-management endpoints.

These are proposed logical routes, not a requirement to implement every route immediately. Use consistent naming and document the actual API.

Every endpoint must have explicit request validation, response schemas, authorization, and error handling.

Do not expose stack traces, provider responses containing secrets, or internal database details to clients.

## 15. Frontend Requirements

Build a minimal, professional Next.js interface.

### Customer interface

- Chat input and conversation history.
- Readable AI answers.
- Expandable citations.
- Loading and error states.
- Clarification and abstention messages.
- Human-support request and ticket status.
- Clear indication when a response is AI-generated.

### Staff interface

- Role-appropriate navigation.
- Knowledge-base document list and upload form.
- Document ingestion status and errors.
- Support inbox with filtering by status and priority.
- Ticket detail view with conversation history.
- Ticket assignment, internal notes, replies, and status changes.

### Admin interface

- Tenant membership and role management.
- Basic tenant settings.
- Relevant audit events.

Do not build all screens in one step. Implement the minimum interface required for each workflow and expand incrementally.

The UI must never be the only enforcement point for permissions.

Provide accessible labels, keyboard navigation, sensible responsive layouts, and useful empty/loading/error states.

## 16. Reliability and Failure Handling

AI and database dependencies can fail. The application must degrade safely.

- Use request and provider timeouts.
- Retry only transient failures and only a bounded number of times.
- Use exponential backoff with jitter where appropriate.
- Respect provider rate limits.
- Avoid retrying non-idempotent operations without idempotency controls.
- Handle unavailable embedding, model, and database services explicitly.
- Do not fabricate an answer after retrieval or generation fails.
- Offer safe fallback or escalation when possible.
- Keep ticket creation independent of a successful AI response where feasible.
- Persist workflow state needed for recovery rather than relying on in-memory process state.
- Make repeated user submissions safe where practical.
- Set appropriate input, output, file, and execution limits.

Document which operations are synchronous and which require durable background processing.

## 17. Observability

Use structured logs and correlation IDs.

Capture appropriate operational metadata, including:

- Request and correlation IDs.
- Tenant and user references where safe.
- Workflow outcome.
- Retrieval duration and result count.
- Model and embedding model identifiers.
- Token usage and estimated cost where available.
- Latency.
- Error categories.
- Escalation reason.
- Citation validation outcome.

Do not log API keys, full authentication tokens, or unnecessary personal information. Avoid logging full conversation content by default.

Use an error-monitoring and observability provider only when configured. The app must still function when optional monitoring is not configured.

## 18. Evaluation and Quality

Create a repeatable evaluation dataset covering representative support questions.

Include examples of:

- Questions answerable from a single document.
- Questions requiring multiple sources.
- Missing information.
- Contradictory sources.
- Outdated documents.
- Tenant-isolation attempts.
- Prompt-injection attempts in user content and uploaded documents.
- Unauthorized order requests.
- Explicit requests for human support.
- Model, embedding, and database failures.

Measure:

- Retrieval relevance or recall on labeled examples.
- Answer correctness.
- Groundedness and citation validity.
- Abstention quality.
- Appropriate escalation rate.
- Unauthorized access prevention.
- Latency and estimated cost.

Use deterministic assertions for security, schemas, citations, and workflow behavior wherever possible. LLM-based grading may supplement but must not replace deterministic tests.

Keep a small, versioned evaluation dataset in the repository without real customer data or secrets.

## 19. Testing Strategy

### Unit tests

Test:

- Permission checks.
- Tenant context resolution.
- Input and output schemas.
- Chunking and document versioning.
- Citation validation.
- Retrieval filtering.
- Ticket state transitions.
- Tool authorization.
- Error mapping and retry decisions.

### Integration tests

Test:

- Database migrations.
- Document ingestion and retrieval.
- Tenant-scoped queries.
- AI workflow branches using mocked model responses.
- Order ownership checks.
- Ticket creation and assignment.
- Document publication and retirement.

### End-to-end tests

Test at least:

1. Customer asks an answerable question and sees valid citations.
2. Customer asks an unanswerable question and receives an appropriate fallback.
3. Customer requests a human and a ticket is created.
4. Knowledge Manager uploads a document and it becomes retrievable.
5. Support Agent claims and resolves a ticket.
6. A customer cannot access another customer's order or conversation.
7. One tenant cannot retrieve another tenant's documents.
8. An unauthorized user cannot upload documents or administer the tenant.

Tests must not require paid OpenAI API calls by default. Use mocked provider responses for ordinary CI. Keep live-provider evaluation optional and explicitly configured.

## 20. Security Acceptance Criteria

Before the project is considered ready for review:

- Production authentication uses verified identity.
- Development identity shortcuts are disabled in production.
- Every protected operation performs server-side authorization.
- Tenant isolation is tested at database and retrieval boundaries.
- Order lookup verifies ownership.
- Document uploads are permission-protected and validated.
- Citation references are validated against retrieved evidence.
- Secrets are never committed or returned to the browser.
- Internal notes are never exposed to customers.
- Rate and resource limits exist for expensive endpoints.
- Prompt injection cannot grant privileges or bypass authorization.
- Production and preview data are isolated.
- Administrative and ticket actions produce appropriate audit events.

## 21. Development Workflow: Small Steps and PRs

Cursor AI must treat this specification as the source of truth.

Implement the application incrementally. Each step must produce one focused branch and one pull request.

For every step:

1. Read the project specification and `AGENTS.md`.
2. Inspect repository state and existing code.
3. State the proposed plan, acceptance criteria, and key decisions.
4. Identify security and deployment implications.
5. Implement only the approved step.
6. Add or update tests and documentation.
7. Run relevant formatting, linting, type-checking, unit, and integration checks.
8. Review the diff for scope creep, secrets, and unsafe defaults.
9. Create a focused commit.
10. Push the branch and open a PR against the default branch.
11. Summarize changes, test results, decisions, limitations, and learning points.
12. Stop and wait for explicit approval before beginning the next step.

Never merge a PR without the user's explicit authorization. Never claim a test, push, deployment, or PR succeeded unless it actually succeeded.

If the agent cannot access GitHub or lacks permission to open a PR, it must report the blocker and provide the local branch and commit details. It must not pretend a PR exists.

Each PR should be small enough for a developer to review and explain during a technical assessment.

## 22. Proposed Implementation Roadmap

The agent may refine this roadmap into smaller steps and PRs. It must preserve the dependencies and acceptance criteria.

### Phase A — Foundation

**Step 0: Specification and repository foundation**
- Establish project documentation, `AGENTS.md`, repository conventions, environment examples, PR template, and CI.
- Do not implement application features.

**Step 1: Next.js application foundation**
- Create the Next.js App Router project.
- Configure TypeScript, linting, formatting, tests, environment validation, and basic layout.
- Add health and readiness routes.
- Verify Vercel-compatible build configuration.

**Step 2: Database and tenant model**
- Configure PostgreSQL and `pgvector`.
- Add schema, migrations, and seed data.
- Implement tenant, user, membership, role, and audit-event foundations.
- Test tenant-scoped data access.

**Step 3: Authentication and authorization**
- Integrate the selected production authentication provider.
- Add development-only seeded identities behind explicit environment gating.
- Implement centralized permissions and authorization tests.

### Phase B — Knowledge and AI

**Step 4: Document ingestion**
- Implement protected document upload, metadata, versions, chunking, embeddings, and ingestion status.

**Step 5: Retrieval**
- Implement tenant-scoped vector retrieval, relevance filtering, and source metadata.
- Add retrieval tests and a small evaluation dataset.

**Step 6: Grounded answer generation**
- Add model-provider abstraction, structured outputs, citation validation, abstention, and safe error handling.

**Step 7: Support API and conversation persistence**
- Add the customer messaging API, conversation history, validation, and authorization.

**Step 8: Controlled AI workflow**
- Add explicit workflow states, retrieval, evidence checks, answer generation, and escalation decisions.
- Use LangGraph.js if justified by the workflow complexity.

**Step 9: Authorized order lookup**
- Implement a read-only order tool with strict ownership checks and limited returned fields.

### Phase C — Human Support

**Step 10: Ticket and escalation backend**
- Add ticket lifecycle, escalation reasons, assignment, staff notes, replies, and audit events.

**Step 11: Staff workflows**
- Add knowledge-manager document operations, support-agent ticket operations, and admin membership management.

**Step 12: Customer chat UI**
- Add chat, citations, conversation history, fallback states, and ticket status.

**Step 13: Staff UI**
- Add knowledge-base management, support inbox, ticket detail, and basic admin screens.

### Phase D — Quality and Production

**Step 14: Evaluation harness**
- Add repeatable retrieval and answer evaluations, failure cases, and quality reporting.

**Step 15: Security hardening**
- Review authentication, authorization, tenant isolation, upload validation, prompt injection, rate limits, and audit coverage.
- Fix issues found; do not defer foundational security controls until this phase.

**Step 16: Reliability and observability**
- Add structured logs, correlation IDs, bounded retries, timeout policies, error handling, and usage metrics.

**Step 17: Cloud deployment**
- Configure Vercel, managed PostgreSQL, environment variables, migrations, preview isolation, and production settings.
- Verify deployed critical workflows and document rollback and recovery procedures.

**Step 18: Assessment readiness**
- Prepare architecture diagrams, ADRs, threat model, evaluation results, cost and latency trade-offs, demo script, known limitations, and reviewer questions.
- Ensure the user can explain the implementation and make live changes confidently.

## 23. Required Documentation

Maintain the following documents as the project evolves:

- `README.md` — setup, commands, architecture summary, and deployment links.
- `AGENTS.md` — mandatory coding-agent workflow and project rules.
- `docs/project-spec.md` — this specification.
- `docs/architecture.md` — components, boundaries, data flow, and deployment topology.
- `docs/security.md` — threat model, tenant isolation, authorization, and security decisions.
- `docs/deployment.md` — local, preview, and production deployment.
- `docs/evaluation.md` — dataset, metrics, results, and limitations.
- `docs/adr/` — architecture decision records.
- `docs/runbooks/` — migration, incident, and recovery procedures where appropriate.

Update documentation in the same PR as the behavior it describes.

## 24. Definition of Done

A step is complete only when:

- Its acceptance criteria are met.
- Relevant tests have been added and pass.
- Formatting, linting, and type checks pass.
- Security and tenant-isolation implications have been reviewed.
- The implementation is compatible with the target deployment architecture.
- Documentation reflects the actual behavior.
- No secrets or unrelated changes are included.
- The PR accurately reports checks, limitations, and decisions.
- The user has reviewed and approved the PR before the next step starts.

The final application is complete when the core customer, knowledge-manager, support-agent, and tenant-admin workflows work end to end in a deployed cloud environment, security tests pass, evaluation results are documented, and the architecture and trade-offs can be explained clearly.

## 25. Guiding Engineering Principles

- Prefer a modular monolith over premature microservices.
- Prefer deterministic authorization and business logic over model-driven decisions.
- Treat model output as untrusted input.
- Never trust prompts to enforce security.
- Keep tenant boundaries explicit.
- Prefer evidence-grounded answers and safe abstention over confident guesses.
- Use durable storage for persistent state.
- Design for Vercel's execution limits from the beginning.
- Keep provider integrations replaceable where practical.
- Measure quality, latency, and cost rather than relying on anecdotes.
- Make each PR small, testable, explainable, and reversible.
- Favor learning and deliberate review over letting an agent generate the entire application without supervision.
