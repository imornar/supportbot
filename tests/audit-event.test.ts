import { describe, expect, it } from "vitest";
import { parseAuditEvent } from "@/server/db/audit";

const valid = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "10000000-0000-4000-8000-000000000001",
  action: "tenant:settings:manage",
  targetType: "membership",
  targetId: "30000000-0000-4000-8000-000000000001",
};

describe("audit events", () => {
  it("accepts actor, tenant, action, and target", () => {
    expect(parseAuditEvent(valid)).toEqual(valid);
  });

  it("rejects a free-form payload and does not echo it", () => {
    const secret = "sk-live-do-not-log";
    expect(() =>
      parseAuditEvent({ ...valid, payload: { note: secret } }),
    ).toThrow(/actor, tenant, action, and target/);
    try {
      parseAuditEvent({ ...valid, secret });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
