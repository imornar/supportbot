import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import {
  findUserBySubject,
  isProviderSubject,
} from "@/server/auth/provider-link";
import { auth } from "@/server/auth/config";
import { DEV_USER_COOKIE, decideDevIdentity } from "@/server/auth/dev-identity";
import { permissionsForRoles } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import {
  roleAssignments,
  tenantMemberships,
  tenants,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import type { CustomerChatViewer, CustomerTenant } from "@/customer-ui/types";

export type { CustomerChatViewer, CustomerTenant };

export type MembershipRoleRow = {
  tenantId: string;
  name: string;
  role: string | null;
};

/**
 * Tenants where this person can ask a question. The chat page offers only
 * these ids. The message route still loads membership before it writes.
 */
export function customerTenantsFromMemberships(
  rows: readonly MembershipRoleRow[],
): CustomerTenant[] {
  const byTenant = new Map<string, { name: string; roles: string[] }>();
  for (const row of rows) {
    const current = byTenant.get(row.tenantId) ?? {
      name: row.name,
      roles: [],
    };
    if (row.role) {
      current.roles.push(row.role);
    }
    byTenant.set(row.tenantId, current);
  }

  const allowed: CustomerTenant[] = [];
  for (const [id, value] of byTenant) {
    let permissions: readonly string[];
    try {
      permissions = permissionsForRoles(value.roles);
    } catch {
      continue;
    }
    if (!permissions.includes("conversation:create")) {
      continue;
    }
    allowed.push({ id, name: value.name });
  }
  allowed.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  return allowed;
}

export async function listCustomerTenants(
  db: TenantQueryClient,
  userId: string,
): Promise<CustomerTenant[]> {
  const rows = await db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      role: roleAssignments.role,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .leftJoin(
      roleAssignments,
      and(
        eq(roleAssignments.membershipId, tenantMemberships.id),
        eq(roleAssignments.tenantId, tenantMemberships.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.status, "active"),
      ),
    );
  return customerTenantsFromMemberships(rows);
}

export async function loadCustomerViewer(): Promise<CustomerChatViewer> {
  try {
    const identity = await currentIdentity();
    if (identity.kind !== "user") {
      return identity;
    }
    const tenantsForUser = await listCustomerTenants(getDb(), identity.userId);
    return { kind: "signed_in", tenants: tenantsForUser };
  } catch {
    console.error("customer viewer failed");
    return { kind: "unavailable" };
  }
}

async function currentIdentity(): Promise<
  | { kind: "anonymous" }
  | { kind: "rejected" }
  | { kind: "user"; userId: string }
  | { kind: "signed_in"; tenants: [] }
> {
  const jar = await cookies();
  const dev = decideDevIdentity(process.env, {
    header: null,
    cookie: jar.get(DEV_USER_COOKIE)?.value ?? null,
    query: null,
  });
  if (dev.status === "rejected") {
    return { kind: "rejected" };
  }
  if (dev.status === "accepted") {
    return { kind: "user", userId: dev.userId };
  }
  if (!hasSessionCookie(jar.getAll())) {
    return { kind: "anonymous" };
  }

  const session = await auth();
  if (
    session?.authProvider !== "github" ||
    !session.authSubject ||
    !isProviderSubject(session.authSubject)
  ) {
    return { kind: "anonymous" };
  }
  const user = await findUserBySubject(
    getDb(),
    session.authProvider,
    session.authSubject,
  );
  if (!user) {
    return { kind: "signed_in", tenants: [] };
  }
  return { kind: "user", userId: user.userId };
}

function hasSessionCookie(all: readonly { name: string }[]): boolean {
  return all.some((cookie) => {
    const name = cookie.name;
    return (
      name === "authjs.session-token" ||
      name.startsWith("authjs.session-token.") ||
      name === "__Secure-authjs.session-token" ||
      name.startsWith("__Secure-authjs.session-token.")
    );
  });
}
