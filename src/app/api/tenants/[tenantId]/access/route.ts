import {
  accessErrorResponse,
  requirePermission,
  type AccessDeps,
} from "@/server/auth/access";
import { isPermission, type Permission } from "@/server/auth/permissions";

type AccessCheck = typeof requirePermission;

export function createTenantAccessHandler(
  check: AccessCheck = requirePermission,
  deps?: AccessDeps,
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ tenantId: string }> },
  ) {
    const { tenantId } = await context.params;
    const requested = new URL(request.url).searchParams.get("permission");
    if (!requested || !isPermission(requested)) {
      return Response.json({ error: "permission_required" }, { status: 400 });
    }
    try {
      const access = await check(request, requested, { tenantId }, deps);
      return Response.json({
        userId: access.userId,
        tenantId: access.tenantId,
        permission: requested satisfies Permission,
      });
    } catch (error) {
      const response = accessErrorResponse(error);
      if (response) {
        return response;
      }
      throw error;
    }
  };
}

export const GET = createTenantAccessHandler();
