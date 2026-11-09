import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

/** Requires `document:retire`. */
export const POST = handlers.retire;
