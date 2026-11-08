/**
 * Permission names from spec section 6.
 * A role is not a superset of the roles below it. A person who needs two
 * jobs holds two role assignments, and the check uses the union.
 * `requirePermission` loads that union from the database on each request.
 */

export const permissions = [
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
] as const;

export type Permission = (typeof permissions)[number];

export const roles = [
  "customer",
  "knowledge_manager",
  "support_agent",
  "tenant_admin",
] as const;

export type Role = (typeof roles)[number];

const permissionSet = new Set<string>(permissions);

export const rolePermissions: Record<Role, readonly Permission[]> = {
  customer: [
    "conversation:read",
    "conversation:create",
    "order:read",
    "ticket:read",
  ],
  knowledge_manager: [
    "document:read",
    "document:create",
    "document:update",
    "document:retire",
  ],
  support_agent: [
    "ticket:read",
    "ticket:claim",
    "ticket:reply",
    "ticket:resolve",
  ],
  tenant_admin: [
    "tenant:user:manage",
    "tenant:settings:manage",
    "audit:read",
    "document:read",
    "ticket:read",
  ],
};

export function isRole(value: string): value is Role {
  return Object.hasOwn(rolePermissions, value);
}

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

export function permissionsForRoles(assigned: readonly string[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of assigned) {
    if (!isRole(role)) {
      throw new Error("Unknown role. Values are omitted.");
    }
    for (const permission of rolePermissions[role]) {
      granted.add(permission);
    }
  }
  return permissions.filter((permission) => granted.has(permission));
}
