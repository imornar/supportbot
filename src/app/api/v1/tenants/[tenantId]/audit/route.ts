import { createTenantAdminHandlers } from "@/server/tenants/handlers";

const handlers = createTenantAdminHandlers();

/** Requires `audit:read` in the path tenant. */
export const GET = handlers.listAudit;
