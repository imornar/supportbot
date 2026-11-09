import { createStaffSessionHandler } from "@/server/staff-ui/session";

const handler = createStaffSessionHandler();

/** Returns the caller's staff tenants. Screens use it for navigation only. */
export const GET = handler;
