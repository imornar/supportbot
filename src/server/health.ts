import { z } from "zod";

const healthSchema = z
  .object({
    status: z.literal("ok"),
  })
  .strict();

export const databaseStates = ["up", "down", "not_configured"] as const;

export type DatabaseState = (typeof databaseStates)[number];

const readinessSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    database: z.enum(databaseStates),
  })
  .strict();

export type HealthBody = z.infer<typeof healthSchema>;
export type ReadinessBody = z.infer<typeof readinessSchema>;

export function healthBody(): HealthBody {
  return healthSchema.parse({ status: "ok" });
}

export function readinessBody(database: DatabaseState): ReadinessBody {
  return readinessSchema.parse({
    status: database === "up" ? "ready" : "not_ready",
    database,
  });
}

export function readinessHttpStatus(body: ReadinessBody): number {
  return body.status === "ready" ? 200 : 503;
}
