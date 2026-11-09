import { createTicketHandlers } from "@/server/tickets/handlers";

const handlers = createTicketHandlers();

export const GET = handlers.list;
export const POST = handlers.create;
