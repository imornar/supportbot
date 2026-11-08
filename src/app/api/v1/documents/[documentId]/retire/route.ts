import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

export const POST = handlers.retire;
