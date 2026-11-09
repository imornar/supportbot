import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

/** Requires `document:read`. */
export const GET = handlers.read;
