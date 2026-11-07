import { defineConfig } from "drizzle-kit";

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!url) {
  throw new Error(
    "DIRECT_URL or DATABASE_URL is required for Drizzle Kit. See docs/runbooks/migrations.md. Values are omitted.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  migrations: {
    schema: "public",
    table: "__drizzle_migrations",
  },
});
