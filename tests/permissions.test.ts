import { describe, expect, it } from "vitest";
import {
  permissions,
  permissionsForRoles,
  rolePermissions,
  roles,
} from "@/server/auth/permissions";

describe("permission names", () => {
  it("matches the spec list", () => {
    expect([...permissions]).toEqual([
      "conversation:read",
      "conversation:create",
      "order:read",
      "document:read",
      "document:create",
      "document:update",
      "document:retire",
      "ticket:read",
      "ticket:claim",
      "ticket:reply",
      "ticket:resolve",
      "tenant:user:manage",
      "tenant:settings:manage",
      "audit:read",
    ]);
  });

  it("gives every permission to at least one role", () => {
    const granted = new Set(Object.values(rolePermissions).flat());
    expect(
      permissions.filter((permission) => !granted.has(permission)),
    ).toEqual([]);
  });

  it("keeps private orders and tenant administration on different roles", () => {
    expect(rolePermissions.knowledge_manager).not.toContain("order:read");
    expect(rolePermissions.tenant_admin).not.toContain("order:read");
    expect(rolePermissions.support_agent).not.toContain("tenant:user:manage");
    expect(rolePermissions.customer).not.toContain("document:create");
  });

  it("unions multiple roles in spec order", () => {
    expect(permissionsForRoles(["support_agent", "knowledge_manager"])).toEqual(
      [
        "document:read",
        "document:create",
        "document:update",
        "document:retire",
        "ticket:read",
        "ticket:claim",
        "ticket:reply",
        "ticket:resolve",
      ],
    );
  });

  it("rejects an unknown role without echoing it", () => {
    const unknown = "platform_owner";
    expect(() => permissionsForRoles([unknown])).toThrow(/Unknown role/);
    try {
      permissionsForRoles([unknown]);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(unknown);
    }
  });

  it("lists the four spec roles", () => {
    expect([...roles]).toEqual([
      "customer",
      "knowledge_manager",
      "support_agent",
      "tenant_admin",
    ]);
  });
});
