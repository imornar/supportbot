import { createTicketHandlers } from "@/server/tickets/handlers";

const handlers = createTicketHandlers();

export const POST = handlers.claim;
