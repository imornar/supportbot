import { createDocumentHandlers } from "@/server/documents/handlers";

const handlers = createDocumentHandlers();

export const GET = handlers.list;
export const POST = handlers.create;
