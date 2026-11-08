import { seedDevelopmentDatabase } from "@/server/db/seed";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    "DATABASE_URL is not configured. See docs/deployment.md. Values are omitted.",
  );
  process.exit(1);
}

try {
  await seedDevelopmentDatabase(connectionString);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Seed failed.";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}
