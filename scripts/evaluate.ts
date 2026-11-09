import { runEvaluation } from "@/server/evaluation/run";
import {
  evaluationPassed,
  formatEvaluationReport,
} from "@/server/evaluation/report";
import { closePool } from "@/server/db/client";

const args = process.argv.slice(2);
const known = new Set(["--strict", "--live"]);
const unknown = args.filter((arg) => !known.has(arg));
if (unknown.length > 0) {
  console.error("Usage: npm run eval -- [--strict] [--live]");
  process.exit(1);
}

const strict = args.includes("--strict");
const live = args.includes("--live");

try {
  const report = await runEvaluation({
    useDatabase: true,
    live,
    env: process.env,
  });
  process.stdout.write(formatEvaluationReport(report));
  if (!evaluationPassed(report, { strict, live })) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
} finally {
  await closePool();
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Evaluation failed.";
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]");
}
