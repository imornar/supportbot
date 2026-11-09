import { createTicketHandlers } from "@/server/tickets/handlers";

const handlers = createTicketHandlers();

/** Requires `ticket:read`. `status` and `priority` filter that tenant's queue. */
export const GET = handlers.list;
export const POST = handlers.create;
