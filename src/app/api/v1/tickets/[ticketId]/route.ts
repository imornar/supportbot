import { createTicketHandlers } from "@/server/tickets/handlers";

const handlers = createTicketHandlers();

export const GET = handlers.read;
