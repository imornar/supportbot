import { healthBody } from "@/server/health";

export function GET() {
  return Response.json(healthBody());
}
