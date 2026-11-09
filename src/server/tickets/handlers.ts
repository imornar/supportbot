import { z } from "zod";

import {
  accessErrorResponse,
  requirePermission,
  type AccessDeps,
} from "@/server/auth/access";
import type { Permission } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  claimTicket,
  createCustomerTicket,
  listTickets,
  readTicket,
  reopenTicket,
  replyToTicket,
  resolveTicket,
  TicketRequestError,
} from "@/server/tickets/store";
import {
  createTicketBodySchema,
  ticketAudience,
  ticketReplyBodySchema,
  type TicketAudience,
} from "@/server/tickets/schema";

const maxBodyBytes = 16 * 1024;

export type TicketHandlerDeps = {
  authorize: typeof requirePermission;
  db: () => TenantQueryClient;
  accessDeps?: AccessDeps;
};

export function createTicketHandlers(overrides?: Partial<TicketHandlerDeps>) {
  const deps: TicketHandlerDeps = {
    authorize: requirePermission,
    db: getDb,
    ...overrides,
  };

  return {
    async create(request: Request): Promise<Response> {
      return guard(async () => {
        const body = await readJson(request, createTicketBodySchema);
        if (body instanceof Response) {
          return body;
        }
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(
          deps,
          request,
          "conversation:create",
          tenantId,
        );
        const result = await createCustomerTicket(deps.db(), {
          tenantId: actor.tenantId,
          userId: actor.userId,
          conversationId: body.conversationId,
          reason: body.reason,
        });
        return Response.json(
          { ticket: result.ticket },
          { status: result.created ? 201 : 200 },
        );
      });
    },

    async list(request: Request): Promise<Response> {
      return guard(async () => {
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(deps, request, "ticket:read", tenantId);
        const tickets = await listTickets(deps.db(), actor);
        return Response.json(tickets);
      });
    },

    async read(
      request: Request,
      context: { params: Promise<{ ticketId: string }> },
    ): Promise<Response> {
      return guard(async () => {
        const ticketId = await ticketIdFrom(context);
        if (ticketId instanceof Response) {
          return ticketId;
        }
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(deps, request, "ticket:read", tenantId);
        const ticket = await readTicket(deps.db(), actor, ticketId);
        return Response.json(ticket);
      });
    },

    async claim(
      request: Request,
      context: { params: Promise<{ ticketId: string }> },
    ): Promise<Response> {
      return mutate(deps, request, context, "ticket:claim", (actor, ticketId) =>
        claimTicket(deps.db(), actor, ticketId),
      );
    },

    async reply(
      request: Request,
      context: { params: Promise<{ ticketId: string }> },
    ): Promise<Response> {
      return guard(async () => {
        const ticketId = await ticketIdFrom(context);
        if (ticketId instanceof Response) {
          return ticketId;
        }
        const body = await readJson(request, ticketReplyBodySchema);
        if (body instanceof Response) {
          return body;
        }
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const actor = await authorize(deps, request, "ticket:reply", tenantId);
        const ticket = await replyToTicket(deps.db(), actor, ticketId, body);
        return Response.json(ticket);
      });
    },

    async resolve(
      request: Request,
      context: { params: Promise<{ ticketId: string }> },
    ): Promise<Response> {
      return mutate(
        deps,
        request,
        context,
        "ticket:resolve",
        (actor, ticketId) => resolveTicket(deps.db(), actor, ticketId),
      );
    },

    async reopen(
      request: Request,
      context: { params: Promise<{ ticketId: string }> },
    ): Promise<Response> {
      return mutate(
        deps,
        request,
        context,
        "ticket:resolve",
        (actor, ticketId) => reopenTicket(deps.db(), actor, ticketId),
      );
    },
  };
}

async function mutate(
  deps: TicketHandlerDeps,
  request: Request,
  context: { params: Promise<{ ticketId: string }> },
  permission: Permission,
  run: (
    actor: { tenantId: string; userId: string; audience: TicketAudience },
    ticketId: string,
  ) => Promise<unknown>,
): Promise<Response> {
  return guard(async () => {
    const ticketId = await ticketIdFrom(context);
    if (ticketId instanceof Response) {
      return ticketId;
    }
    const tenantId = tenantFromQuery(request);
    if (tenantId instanceof Response) {
      return tenantId;
    }
    const actor = await authorize(deps, request, permission, tenantId);
    const ticket = await run(actor, ticketId);
    return Response.json(ticket);
  });
}

async function authorize(
  deps: TicketHandlerDeps,
  request: Request,
  permission: Permission,
  tenantId: string,
) {
  const access = await deps.authorize(
    request,
    permission,
    { tenantId },
    deps.accessDeps,
  );
  return {
    tenantId: access.tenantId,
    userId: access.userId,
    audience: ticketAudience(access.permissions),
  };
}

async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = ticketErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("ticket request failed");
    return Response.json({ error: "ticket_failed" }, { status: 500 });
  }
}

export function ticketErrorResponse(error: unknown): Response | null {
  const access = accessErrorResponse(error);
  if (access) {
    return access;
  }
  if (error instanceof TicketRequestError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "illegal_transition" || error.code === "ticket_held"
          ? 409
          : 400;
    return Response.json({ error: error.code }, { status });
  }
  return null;
}

async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return Response.json({ error: "validation_failed" }, { status: 400 });
    }
    return parsed.data;
  } catch {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
}

function tenantFromQuery(request: Request): string | Response {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId || !z.uuid().safeParse(tenantId).success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  return tenantId;
}

async function ticketIdFrom(context: {
  params: Promise<{ ticketId: string }>;
}): Promise<string | Response> {
  const { ticketId } = await context.params;
  const parsed = ticketId.trim().toLowerCase();
  if (!z.uuid().safeParse(parsed).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return parsed;
}
