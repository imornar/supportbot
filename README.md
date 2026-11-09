# SupportPilot

Multi-tenant AI customer support. Customers get answers grounded in approved documents. Staff manage those documents and a human support inbox. The model does not grant access to private data.

The product requirements are in [`spec.md`](spec.md). The build order is in [`docs/roadmap.md`](docs/roadmap.md). Agent rules are in [`AGENTS.md`](AGENTS.md).

The app is a Next.js App Router project. The home page is the customer chat: it posts questions to `POST /api/v1/support/messages` and shows ticket status from that response. The browser does not call the model. Local setup is in [`docs/deployment.md`](docs/deployment.md). Postgres runs from Docker Compose, with migrations in [`docs/runbooks/migrations.md`](docs/runbooks/migrations.md). Tenant ownership, Auth.js sessions, permission checks, and why Row Level Security waits are in [`docs/security.md`](docs/security.md). `GET /api/health` and `GET /api/ready` stay public. GitHub sign-in is `/api/auth/signin/github`. The development identity page is `/dev/identity` and only renders when that switch is enabled. Architecture limits are in [`docs/architecture.md`](docs/architecture.md).

## Working agreement

Each roadmap step is one branch and one pull request. The reviewer merges. The next step starts only after that approval.
