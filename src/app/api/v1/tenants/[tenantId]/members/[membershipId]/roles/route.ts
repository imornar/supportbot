import { createTenantAdminHandlers } from "@/server/tenants/handlers";

const handlers = createTenantAdminHandlers();

/** Requires `tenant:user:manage` in the path tenant. */
export const POST = handlers.assignRole;
