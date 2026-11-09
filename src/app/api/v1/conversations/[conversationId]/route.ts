import { createConversationHandlers } from "@/server/conversations/handlers";

const handlers = createConversationHandlers();

export const GET = handlers.read;
