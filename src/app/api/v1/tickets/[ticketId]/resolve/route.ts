import { createTicketHandlers } from "@/server/tickets/handlers";

const handlers = createTicketHandlers();

export const POST = handlers.resolve;
