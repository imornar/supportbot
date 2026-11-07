import { databaseReadiness } from "@/server/env";
import { readinessBody, readinessHttpStatus } from "@/server/health";

export function GET() {
  const body = readinessBody(databaseReadiness());
  return Response.json(body, { status: readinessHttpStatus(body) });
}
