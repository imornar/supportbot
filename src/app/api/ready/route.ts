import { checkDatabase } from "@/server/db/readiness";
import { readinessBody, readinessHttpStatus } from "@/server/health";

export async function GET() {
  const body = readinessBody(await checkDatabase());
  return Response.json(body, { status: readinessHttpStatus(body) });
}
