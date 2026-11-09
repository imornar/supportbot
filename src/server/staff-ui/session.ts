import "server-only";

import { and, eq } from "drizzle-orm";

import { auth } from "@/server/auth/config";
import {
  decideDevIdentity,
  devIdentitySignals,
} from "@/server/auth/dev-identity";
import {
  findUserBySubject,
  isProviderSubject,
} from "@/server/auth/provider-link";
import { permissionsForRoles } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import {
  roleAssignments,
  tenantMemberships,
  tenants,
} from "@/server/db/schema";

const staffGate = new Set<string>([
  "document:read",
  "document:create",
  "document:update",
  "document:retire",
  "ticket:claim",
  "ticket:reply",
  "ticket:resolve",
  "tenant:user:manage",
  "tenant:settings:manage",
  "audit:read",
]);

export type StaffMembershipRow = {
  tenantId: string;
  name: string;
  role: string | null;
};

export type StaffSessionTenant = {
  id: string;
  name: string;
  permissions: string[];
};

export type StaffIdentity =
  | { status: "anonymous" }
  | { status: "rejected" }
  | { status: "unlinked" }
  | { status: "user"; userId: string };

/**
 * Tenants where this person has a staff permission.
 * `ticket:read` alone is a customer. It does not open the inbox.
 * Unknown roles drop that tenant instead of granting a screen.
 */
export function staffSessionFromMemberships(
  rows: readonly StaffMembershipRow[],
): StaffSessionTenant[] {
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

  const tenantsForUser: StaffSessionTenant[] = [];
  for (const [id, value] of byTenant) {
    let permissions: string[];
    try {
      permissions = permissionsForRoles(value.roles);
    } catch {
      continue;
    }
    if (!permissions.some((permission) => staffGate.has(permission))) {
      continue;
    }
    tenantsForUser.push({ id, name: value.name, permissions });
  }
  tenantsForUser.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  return tenantsForUser;
}

export type StaffSessionDeps = {
  identify: (request: Request) => Promise<StaffIdentity>;
  memberships: (userId: string) => Promise<StaffMembershipRow[]>;
};

export function createStaffSessionHandler(
  overrides?: Partial<StaffSessionDeps>,
) {
  const deps: StaffSessionDeps = {
    identify: identifyRequest,
    memberships: listMembershipRows,
    ...overrides,
  };

  return async function GET(request: Request): Promise<Response> {
    try {
      const identity = await deps.identify(request);
      if (identity.status === "rejected") {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (identity.status === "anonymous") {
        return Response.json({ error: "unauthenticated" }, { status: 401 });
      }
      if (identity.status === "unlinked") {
        return Response.json({ tenants: [] });
      }
      const rows = await deps.memberships(identity.userId);
      return Response.json({
        tenants: staffSessionFromMemberships(rows),
      });
    } catch {
      console.error("staff session failed");
      return Response.json({ error: "staff_session_failed" }, { status: 500 });
    }
  };
}

export async function identifyRequest(
  request: Request,
): Promise<StaffIdentity> {
  const dev = decideDevIdentity(process.env, devIdentitySignals(request));
  if (dev.status === "rejected") {
    return { status: "rejected" };
  }
  if (dev.status === "accepted") {
    return { status: "user", userId: dev.userId };
  }
  if (!hasSessionCookie(request.headers.get("cookie"))) {
    return { status: "anonymous" };
  }
  const session = await auth();
  if (
    session?.authProvider !== "github" ||
    !session.authSubject ||
    !isProviderSubject(session.authSubject)
  ) {
    return { status: "anonymous" };
  }
  const user = await findUserBySubject(
    getDb(),
    session.authProvider,
    session.authSubject,
  );
  if (!user) {
    return { status: "unlinked" };
  }
  return { status: "user", userId: user.userId };
}

export async function listMembershipRows(
  userId: string,
): Promise<StaffMembershipRow[]> {
  return getDb()
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
}

function hasSessionCookie(header: string | null): boolean {
  if (!header) {
    return false;
  }
  return header.split(";").some((part) => {
    const name = part.slice(0, part.indexOf("=")).trim();
    return (
      name === "authjs.session-token" ||
      name.startsWith("authjs.session-token.") ||
      name === "__Secure-authjs.session-token" ||
      name.startsWith("__Secure-authjs.session-token.")
    );
  });
}
