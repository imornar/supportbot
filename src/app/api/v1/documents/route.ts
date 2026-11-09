import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

/** Requires `document:read`. */
export const GET = handlers.list;

/** Requires `document:create`, and `document:update` when `newVersion` is set. */
export const POST = handlers.create;
