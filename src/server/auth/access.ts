import "server-only";

import {
  decideDevIdentity,
  devIdentitySignals,
} from "@/server/auth/dev-identity";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import {
  isPermission,
  permissionsForRoles,
  type Permission,
} from "@/server/auth/permissions";
import { findUserBySubject } from "@/server/auth/provider-link";
import { readSessionSubject } from "@/server/auth/config";
import { getDb } from "@/server/db/client";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication is required. Values are omitted.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Permission denied. Values are omitted.");
    this.name = "ForbiddenError";
  }
}

export class DevIdentityRejectedError extends Error {
  constructor() {
    super("Development identity is rejected. Values are omitted.");
    this.name = "DevIdentityRejectedError";
  }
}

export type AccessGrant = {
  userId: string;
  tenantId: string;
  permissions: Permission[];
};

export type AccessDeps = {
  env: Record<string, string | undefined>;
  readSession: () => Promise<{ provider: string; subject: string } | null>;
  findUserBySubject: (
    provider: string,
    subject: string,
  ) => Promise<{ userId: string } | null>;
  findMembership: (
    userId: string,
    tenantId: string,
  ) => Promise<{ roles: readonly string[] } | null>;
};

export function defaultAccessDeps(): AccessDeps {
  return {
    env: process.env,
    readSession: readSessionSubject,
    findUserBySubject: (provider, subject) =>
      findUserBySubject(getDb(), provider, subject),
    findMembership: async (userId, tenantId) =>
      loadMembershipAccess(getDb(), userId, tenantId),
  };
}

/**
 * Server authorization for one permission on one tenant-owned resource.
 * The tenant id is not proof of membership. The caller passes the resource
 * tenant, and this function loads the actor's active membership in that tenant.
 * Development identity signals are rejected outright when the switch is off
 * or when production configuration is active, even if a real session exists.
 */
export async function requirePermission(
  request: Request,
  permission: Permission,
  resource: { tenantId: string },
  deps: AccessDeps = defaultAccessDeps(),
): Promise<AccessGrant> {
  if (!isPermission(permission)) {
    throw new ForbiddenError();
  }
  if (!uuidPattern.test(resource.tenantId)) {
    throw new ForbiddenError();
  }

  const devIdentity = decideDevIdentity(deps.env, devIdentitySignals(request));
  if (devIdentity.status === "rejected") {
    throw new DevIdentityRejectedError();
  }

  const userId =
    devIdentity.status === "accepted"
      ? devIdentity.userId
      : await userIdFromSession(deps);
  if (!userId) {
    throw new UnauthenticatedError();
  }

  const membership = await deps.findMembership(userId, resource.tenantId);
  if (!membership) {
    throw new ForbiddenError();
  }
  const granted = permissionsForRoles(membership.roles);
  if (!granted.includes(permission)) {
    throw new ForbiddenError();
  }
  return {
    userId,
    tenantId: resource.tenantId,
    permissions: granted,
  };
}

export function accessErrorResponse(error: unknown): Response | null {
  if (error instanceof UnauthenticatedError) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (
    error instanceof ForbiddenError ||
    error instanceof DevIdentityRejectedError
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

async function userIdFromSession(deps: AccessDeps): Promise<string | null> {
  const session = await deps.readSession();
  if (!session) {
    return null;
  }
  const user = await deps.findUserBySubject(session.provider, session.subject);
  return user?.userId ?? null;
}
