# SupportPilot

Multi-tenant AI customer support. Customers get answers grounded in approved documents. Staff manage those documents and a human support inbox. The model does not grant access to private data.

The product requirements are in [`spec.md`](spec.md). The build order is in [`docs/roadmap.md`](docs/roadmap.md). Agent rules are in [`AGENTS.md`](AGENTS.md).

The app is a Next.js App Router project. Local setup is in [`docs/deployment.md`](docs/deployment.md). `GET /api/health` and `GET /api/ready` are the only routes besides the home page. Architecture limits are in [`docs/architecture.md`](docs/architecture.md).

## Working agreement

Each roadmap step is one branch and one pull request. The reviewer merges. The next step starts only after that approval.
