import { z } from "zod";

import {
  failureReasons,
  messageFromErrorBody,
  permissionNames,
  roleNames,
  ticketStatuses,
  type StaffTenant,
} from "@/staff-ui/access";

export type { StaffTenant };

const staffTenantSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    permissions: z.array(z.enum(permissionNames)),
  })
  .strict();

export const staffSessionSchema = z
  .object({
    tenants: z.array(staffTenantSchema),
  })
  .strict();

export type StaffSessionBody = z.infer<typeof staffSessionSchema>;

const documentSchema = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    title: z.string(),
    source: z.string(),
    documentType: z.enum(["markdown", "text"]),
    version: z.number().int(),
    publication: z.enum(["draft", "published", "retired"]),
    ingestionStatus: z.enum(["pending", "ready", "failed"]),
    failureReason: z.enum(failureReasons).nullable(),
    checksum: z.string(),
    isCurrent: z.boolean(),
    supersedesDocumentId: z.uuid().nullable(),
    effectiveDate: z.string().nullable(),
    uploadedByUserId: z.uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
    retiredAt: z.string().nullable(),
    body: z.string().optional(),
  })
  .strict();

export type StaffDocument = z.infer<typeof documentSchema>;

const documentListSchema = z
  .object({
    documents: z.array(documentSchema),
  })
  .strict();

const documentCreateSchema = z
  .object({
    document: documentSchema,
    created: z.boolean(),
  })
  .strict();

const citationSchema = z
  .object({
    chunkId: z.uuid(),
    documentId: z.uuid(),
    title: z.string(),
    section: z.string().nullable(),
    excerpt: z.string(),
    documentVersion: z.number(),
    effectiveDate: z.string().nullable(),
  })
  .strict();

const ticketEntrySchema = z
  .object({
    id: z.uuid(),
    body: z.string().max(4_000),
    createdAt: z.string(),
    authorUserId: z.uuid(),
  })
  .strict();

const ticketListItemSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    requesterUserId: z.uuid(),
    reason: z.string().max(64),
    priority: z.enum(["low", "normal", "high"]),
    status: z.enum(ticketStatuses),
    assigneeUserId: z.uuid().nullable(),
    claimedAt: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type StaffTicketListItem = z.infer<typeof ticketListItemSchema>;

const ticketListSchema = z
  .object({
    tickets: z.array(ticketListItemSchema),
  })
  .strict();

export const staffTicketSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    requesterUserId: z.uuid(),
    reason: z.string().max(64),
    priority: z.enum(["low", "normal", "high"]),
    status: z.enum(ticketStatuses),
    assigneeUserId: z.uuid().nullable(),
    claimedAt: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    citations: z.array(citationSchema),
    replies: z.array(ticketEntrySchema),
    notes: z.array(ticketEntrySchema),
    conversation: z.array(
      z
        .object({
          id: z.uuid(),
          role: z.enum(["user", "assistant"]),
          body: z.string().max(4_000),
          createdAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type StaffTicket = z.infer<typeof staffTicketSchema>;

const memberSchema = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    status: z.enum(["active", "deactivated"]),
    roles: z.array(z.enum(roleNames)),
  })
  .strict();

export type StaffMember = z.infer<typeof memberSchema>;

const memberListSchema = z
  .object({
    members: z.array(memberSchema),
  })
  .strict();

const memberResultSchema = z
  .object({
    member: memberSchema,
  })
  .strict();

const settingsSchema = z
  .object({
    publicSupportName: z.string(),
  })
  .strict();

export type TenantSettings = z.infer<typeof settingsSchema>;

const auditEventSchema = z
  .object({
    id: z.uuid(),
    action: z.string().regex(/^[a-z0-9_.:]{1,64}$/),
    targetType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    targetId: z.uuid(),
    actorUserId: z.uuid(),
    createdAt: z.string(),
  })
  .strict();

export type StaffAuditEvent = z.infer<typeof auditEventSchema>;

const auditListSchema = z
  .object({
    events: z.array(auditEventSchema),
  })
  .strict();

export type ApiResult<T> =
  { ok: true; body: T } | { ok: false; message: string };

const failed = "The request failed.";

export async function readApi<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, message: messageFromErrorBody(text) };
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return { ok: false, message: failed };
    }
    return { ok: true, body: parsed.data };
  } catch {
    return { ok: false, message: failed };
  }
}

async function sendJson(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function loadStaffSession(): Promise<ApiResult<StaffSessionBody>> {
  return fetch("/api/v1/staff/session").then((response) =>
    readApi(response, staffSessionSchema),
  );
}

export function loadDocuments(
  tenantId: string,
): Promise<ApiResult<{ documents: StaffDocument[] }>> {
  const params = new URLSearchParams({ tenantId });
  return fetch(`/api/v1/documents?${params.toString()}`).then((response) =>
    readApi(response, documentListSchema),
  );
}

export function createDocument(input: {
  tenantId: string;
  title: string;
  source: string;
  documentType: "markdown" | "text";
  content: string;
}): Promise<ApiResult<{ document: StaffDocument; created: boolean }>> {
  return sendJson("/api/v1/documents", "POST", input).then((response) =>
    readApi(response, documentCreateSchema),
  );
}

export function loadTickets(
  tenantId: string,
  filter: { status: string; priority: string },
): Promise<ApiResult<{ tickets: StaffTicketListItem[] }>> {
  const params = new URLSearchParams({ tenantId });
  if (filter.status) {
    params.set("status", filter.status);
  }
  if (filter.priority) {
    params.set("priority", filter.priority);
  }
  return fetch(`/api/v1/tickets?${params.toString()}`).then((response) =>
    readApi(response, ticketListSchema),
  );
}

export function loadTicket(
  tenantId: string,
  ticketId: string,
): Promise<ApiResult<StaffTicket>> {
  const params = new URLSearchParams({ tenantId });
  return fetch(`/api/v1/tickets/${ticketId}?${params.toString()}`).then(
    (response) => readApi(response, staffTicketSchema),
  );
}

export function postTicketAction(
  tenantId: string,
  ticketId: string,
  action: "claim" | "resolve",
): Promise<ApiResult<StaffTicket>> {
  const params = new URLSearchParams({ tenantId });
  return fetch(`/api/v1/tickets/${ticketId}/${action}?${params.toString()}`, {
    method: "POST",
  }).then((response) => readApi(response, staffTicketSchema));
}

export function postTicketReply(
  tenantId: string,
  ticketId: string,
  body: string,
  visibility: "customer" | "internal",
): Promise<ApiResult<StaffTicket>> {
  const params = new URLSearchParams({ tenantId });
  return sendJson(
    `/api/v1/tickets/${ticketId}/replies?${params.toString()}`,
    "POST",
    { body, visibility },
  ).then((response) => readApi(response, staffTicketSchema));
}

export function loadMembers(
  tenantId: string,
): Promise<ApiResult<{ members: StaffMember[] }>> {
  return fetch(`/api/v1/tenants/${tenantId}/members`).then((response) =>
    readApi(response, memberListSchema),
  );
}

export function sendMemberRequest(request: {
  url: string;
  method: "POST" | "DELETE";
  body?: unknown;
}): Promise<ApiResult<{ member: StaffMember }>> {
  const sent =
    request.body === undefined
      ? fetch(request.url, { method: request.method })
      : sendJson(request.url, "POST", request.body);
  return sent.then((response) => readApi(response, memberResultSchema));
}

export function loadSettings(
  tenantId: string,
): Promise<ApiResult<TenantSettings>> {
  return fetch(`/api/v1/tenants/${tenantId}/settings`).then((response) =>
    readApi(response, settingsSchema),
  );
}

export function saveSettings(
  tenantId: string,
  publicSupportName: string,
): Promise<ApiResult<TenantSettings>> {
  return sendJson(`/api/v1/tenants/${tenantId}/settings`, "PATCH", {
    publicSupportName,
  }).then((response) => readApi(response, settingsSchema));
}

export function loadAudit(
  tenantId: string,
): Promise<ApiResult<{ events: StaffAuditEvent[] }>> {
  return fetch(`/api/v1/tenants/${tenantId}/audit`).then((response) =>
    readApi(response, auditListSchema),
  );
}
