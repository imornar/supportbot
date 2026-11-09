import { createTenantAdminHandlers } from "@/server/tenants/handlers";

const handlers = createTenantAdminHandlers();

/** Requires `tenant:settings:manage` in the path tenant. */
export const GET = handlers.readSettings;

/** Requires `tenant:settings:manage` in the path tenant. */
export const PATCH = handlers.updateSettings;
