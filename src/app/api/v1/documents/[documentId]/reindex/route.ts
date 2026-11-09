import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

/** Requires `document:update`. Reindex writes chunks through the upload path. */
export const POST = handlers.reindex;
