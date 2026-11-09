import "server-only";

import { eq } from "drizzle-orm";

import {
  DevIdentityRejectedError,
  requirePermission,
  UnauthenticatedError,
  type AccessDeps,
} from "@/server/auth/access";
import {
  decideDevIdentity,
  devIdentitySignals,
} from "@/server/auth/dev-identity";
import type { Permission } from "@/server/auth/permissions";
import { tenants } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

import { ConversationRequestError } from "@/server/conversations/store";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SupportActor =
  | { kind: "customer"; userId: string; tenantId: string }
  | { kind: "anonymous" };

/**
 * A signed-in caller names a tenant id only so membership can be loaded.
 * The grant's tenant id is what later writes use. A logged-out caller cannot
 * name a tenant. Their tenant is the row whose slug is
 * `SUPPORTPILOT_PUBLIC_TENANT_SLUG`.
 */
export async function resolveSupportActor(
  request: Request,
  permission: Permission,
  deps: AccessDeps,
  mode: "customer" | "customer-or-public",
): Promise<SupportActor> {
  const devIdentity = decideDevIdentity(deps.env, devIdentitySignals(request));
  if (devIdentity.status === "rejected") {
    throw new DevIdentityRejectedError();
  }
  const userId =
    devIdentity.status === "accepted"
      ? devIdentity.userId
      : await userIdFromSession(deps);
  const tenantFromClient = tenantQuery(request);

  if (userId) {
    if (!tenantFromClient) {
      throw new ConversationRequestError("validation_failed");
    }
    const access = await requirePermission(
      request,
      permission,
      { tenantId: tenantFromClient },
      deps,
    );
    return {
      kind: "customer",
      userId: access.userId,
      tenantId: access.tenantId,
    };
  }

  if (tenantFromClient) {
    throw new ConversationRequestError("validation_failed");
  }
  if (mode === "customer") {
    throw new UnauthenticatedError();
  }
  return { kind: "anonymous" };
}

export async function loadPublicTenantId(
  db: TenantQueryClient,
  env: Record<string, string | undefined>,
): Promise<string> {
  const slug = publicTenantSlug(env);
  if (!slug) {
    throw new ConversationRequestError("public_tenant_unavailable");
  }
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    throw new ConversationRequestError("public_tenant_unavailable");
  }
  return tenant.id;
}

export function publicTenantSlug(
  env: Record<string, string | undefined>,
): string | null {
  const slug = env.SUPPORTPILOT_PUBLIC_TENANT_SLUG?.trim() ?? "";
  if (!slugPattern.test(slug)) {
    return null;
  }
  return slug;
}

function tenantQuery(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("tenantId");
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      parsed,
    )
  ) {
    throw new ConversationRequestError("validation_failed");
  }
  return parsed;
}

async function userIdFromSession(deps: AccessDeps): Promise<string | null> {
  const session = await deps.readSession();
  if (!session) {
    return null;
  }
  const user = await deps.findUserBySubject(session.provider, session.subject);
  return user?.userId ?? null;
}
