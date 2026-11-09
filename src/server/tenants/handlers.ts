import { z } from "zod";

import {
  accessErrorResponse,
  requirePermission,
  type AccessDeps,
} from "@/server/auth/access";
import { isRole, type Permission, type Role } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  assignRole,
  deactivateMembership,
  listMembers,
  revokeRole,
  TenantMemberError,
} from "@/server/tenants/members";
import {
  readTenantSettings,
  TenantSettingsError,
  updatePublicSupportName,
} from "@/server/tenants/settings";
import { isPublicSupportName } from "@/server/workflow/decision";

const maxBodyBytes = 4 * 1024;

const assignBody = z
  .object({
    role: z.string(),
  })
  .strict();

const settingsBody = z
  .object({
    publicSupportName: z.string(),
  })
  .strict();

export type TenantAdminHandlerDeps = {
  authorize: typeof requirePermission;
  db: () => TenantQueryClient;
  accessDeps?: AccessDeps;
};

type MemberContext = {
  params: Promise<{ tenantId: string; membershipId: string }>;
};

type RoleContext = {
  params: Promise<{ tenantId: string; membershipId: string; role: string }>;
};

type TenantContext = {
  params: Promise<{ tenantId: string }>;
};

export function createTenantAdminHandlers(
  overrides?: Partial<TenantAdminHandlerDeps>,
) {
  const deps: TenantAdminHandlerDeps = {
    authorize: requirePermission,
    db: getDb,
    ...overrides,
  };

  return {
    async listMembers(request: Request, context: TenantContext) {
      return guard(async () => {
        const tenantId = await tenantIdFrom(context);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(
          deps,
          request,
          "tenant:user:manage",
          tenantId,
        );
        const members = await listMembers(deps.db(), actor.tenantId);
        return Response.json(members);
      });
    },

    async assignRole(request: Request, context: MemberContext) {
      return guard(async () => {
        const actor = await authorizeTenant(
          deps,
          request,
          context,
          "tenant:user:manage",
        );
        if (actor instanceof Response) {
          return actor;
        }
        const membershipId = await membershipIdFrom(context);
        if (membershipId instanceof Response) {
          return membershipId;
        }
        const body = await readJson(request, assignBody);
        if (body instanceof Response) {
          return body;
        }
        if (!isRole(body.role)) {
          return validationFailed();
        }
        const member = await assignRole(
          deps.db(),
          actor,
          membershipId,
          body.role,
        );
        return Response.json({ member });
      });
    },

    async revokeRole(request: Request, context: RoleContext) {
      return guard(async () => {
        const actor = await authorizeTenant(
          deps,
          request,
          context,
          "tenant:user:manage",
        );
        if (actor instanceof Response) {
          return actor;
        }
        const ids = await roleIdsFrom(context);
        if (ids instanceof Response) {
          return ids;
        }
        const member = await revokeRole(
          deps.db(),
          actor,
          ids.membershipId,
          ids.role,
        );
        return Response.json({ member });
      });
    },

    async deactivate(request: Request, context: MemberContext) {
      return guard(async () => {
        const actor = await authorizeTenant(
          deps,
          request,
          context,
          "tenant:user:manage",
        );
        if (actor instanceof Response) {
          return actor;
        }
        const membershipId = await membershipIdFrom(context);
        if (membershipId instanceof Response) {
          return membershipId;
        }
        const empty = await readEmpty(request);
        if (empty instanceof Response) {
          return empty;
        }
        const member = await deactivateMembership(
          deps.db(),
          actor,
          membershipId,
        );
        return Response.json({ member });
      });
    },

    async readSettings(request: Request, context: TenantContext) {
      return guard(async () => {
        const tenantId = await tenantIdFrom(context);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(
          deps,
          request,
          "tenant:settings:manage",
          tenantId,
        );
        const settings = await readTenantSettings(deps.db(), actor.tenantId);
        return Response.json(settings);
      });
    },

    async updateSettings(request: Request, context: TenantContext) {
      return guard(async () => {
        const actor = await authorizeTenant(
          deps,
          request,
          context,
          "tenant:settings:manage",
        );
        if (actor instanceof Response) {
          return actor;
        }
        const body = await readJson(request, settingsBody);
        if (body instanceof Response) {
          return body;
        }
        if (!isPublicSupportName(body.publicSupportName)) {
          return validationFailed();
        }
        const settings = await updatePublicSupportName(
          deps.db(),
          actor,
          body.publicSupportName,
        );
        return Response.json(settings);
      });
    },
  };
}

async function authorize(
  deps: TenantAdminHandlerDeps,
  request: Request,
  permission: Permission,
  tenantId: string,
) {
  const access = await deps.authorize(
    request,
    permission,
    { tenantId },
    deps.accessDeps,
  );
  return { tenantId: access.tenantId, userId: access.userId };
}

async function authorizeTenant(
  deps: TenantAdminHandlerDeps,
  request: Request,
  context: TenantContext,
  permission: Permission,
) {
  const tenantId = await tenantIdFrom(context);
  if (tenantId instanceof Response) {
    return tenantId;
  }
  return authorize(deps, request, permission, tenantId);
}

async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = tenantAdminErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("tenant admin request failed");
    return Response.json({ error: "tenant_admin_failed" }, { status: 500 });
  }
}

export function tenantAdminErrorResponse(error: unknown): Response | null {
  const access = accessErrorResponse(error);
  if (access) {
    return access;
  }
  if (error instanceof TenantMemberError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "last_admin" || error.code === "membership_inactive"
          ? 409
          : 400;
    return Response.json({ error: error.code }, { status });
  }
  if (error instanceof TenantSettingsError) {
    return Response.json({ error: error.code }, { status: 404 });
  }
  return null;
}

async function tenantIdFrom(
  context: TenantContext,
): Promise<string | Response> {
  const { tenantId } = await context.params;
  if (!z.uuid().safeParse(tenantId).success) {
    return validationFailed();
  }
  return tenantId;
}

async function membershipIdFrom(
  context: MemberContext,
): Promise<string | Response> {
  const { membershipId } = await context.params;
  if (!z.uuid().safeParse(membershipId).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return membershipId;
}

async function roleIdsFrom(
  context: RoleContext,
): Promise<{ membershipId: string; role: Role } | Response> {
  const membershipId = await membershipIdFrom(context);
  if (membershipId instanceof Response) {
    return membershipId;
  }
  const { role } = await context.params;
  if (!isRole(role)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return { membershipId, role };
}

async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  const raw = await readLimited(request);
  if (raw instanceof Response) {
    return raw;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return validationFailed();
    }
    return parsed.data;
  } catch {
    return validationFailed();
  }
}

async function readEmpty(request: Request): Promise<Response | null> {
  const raw = await readLimited(request);
  if (raw instanceof Response) {
    return raw;
  }
  if (raw.trim() === "") {
    return null;
  }
  try {
    const parsed = z.object({}).strict().safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return validationFailed();
    }
    return null;
  } catch {
    return validationFailed();
  }
}

async function readLimited(request: Request): Promise<string | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  return raw;
}

function validationFailed(): Response {
  return Response.json({ error: "validation_failed" }, { status: 400 });
}
