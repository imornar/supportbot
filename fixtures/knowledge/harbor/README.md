# Harbor Goods sample articles

Fictional support articles for the seeded Harbor Goods tenant (`harbor`). `npm run db:seed` does not load them, and the app does not read this folder at runtime.

To try ingestion, paste a file into `POST /api/v1/documents` as `documentType: "markdown"`. Use the Harbor tenant id `11111111-1111-4111-8111-111111111111`. With the development identity switch on, Ken Harbor (`10000000-0000-4000-8000-000000000002`) is the knowledge manager who can upload.

`source` can be the filename, for example `shipping.md`.
