/**
 * Navigation hints for the staff screens.
 * A permission in this list only chooses a link or a control.
 * The route handler checks the same permission again before it reads or writes.
 */

export const permissionNames = [
  "conversation:read",
  "conversation:create",
  "order:read",
  "document:read",
  "document:create",
  "document:update",
  "document:retire",
  "ticket:read",
  "ticket:claim",
  "ticket:reply",
  "ticket:resolve",
  "tenant:user:manage",
  "tenant:settings:manage",
  "audit:read",
] as const;

export type StaffPermission = (typeof permissionNames)[number];

export const roleNames = [
  "customer",
  "knowledge_manager",
  "support_agent",
  "tenant_admin",
] as const;

export type StaffRole = (typeof roleNames)[number];

export const ticketStatuses = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "reopened",
  "closed",
] as const;

export type StaffTicketStatus = (typeof ticketStatuses)[number];

export const failureReasons = [
  "too_large_for_sync_ingestion",
  "embedding_not_configured",
  "embedding_failed",
  "ingestion_failed",
] as const;

export type StaffTenant = {
  id: string;
  name: string;
  permissions: readonly string[];
};

const requestErrors: Record<string, string> = {
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have permission for that action.",
  validation_failed: "The form is not valid.",
  last_admin: "The last tenant admin must keep that role.",
  membership_inactive: "That membership is already deactivated.",
  not_found: "That record was not found.",
  illegal_transition: "That ticket action is not available.",
  ticket_held: "Another agent already holds this ticket.",
  payload_too_large: "That document is too large.",
  not_ready: "The document is not ready.",
  not_current: "That document version is not current.",
  conflict: "The document changed. Reload and try again.",
  ingestion_failed: "The request failed.",
  staff_session_failed: "Staff access could not be loaded.",
  tenant_admin_failed: "The request failed.",
  ticket_failed: "The request failed.",
};

export function can(
  tenant: StaffTenant | null,
  permission: StaffPermission,
): boolean {
  return Boolean(tenant?.permissions.includes(permission));
}

export function canSeeInbox(tenant: StaffTenant | null): boolean {
  return (
    can(tenant, "ticket:read") &&
    (can(tenant, "ticket:claim") ||
      can(tenant, "ticket:reply") ||
      can(tenant, "ticket:resolve") ||
      can(tenant, "tenant:settings:manage"))
  );
}

export function canSeeAdmin(tenant: StaffTenant | null): boolean {
  return (
    can(tenant, "tenant:user:manage") ||
    can(tenant, "tenant:settings:manage") ||
    can(tenant, "audit:read")
  );
}

export function uploadControlVisible(tenant: StaffTenant | null): boolean {
  return can(tenant, "document:create");
}

export type StaffNavItem = {
  href: string;
  label: string;
};

export function staffNav(tenant: StaffTenant | null): StaffNavItem[] {
  const items: StaffNavItem[] = [];
  if (can(tenant, "document:read")) {
    items.push({ href: "/staff/documents", label: "Knowledge" });
  }
  if (canSeeInbox(tenant)) {
    items.push({ href: "/staff/inbox", label: "Inbox" });
  }
  if (canSeeAdmin(tenant)) {
    items.push({ href: "/staff/admin", label: "Administration" });
  }
  return items;
}

export function withTenant(href: string, tenantId: string | null): string {
  if (!tenantId) {
    return href;
  }
  const params = new URLSearchParams({ tenantId });
  return `${href}?${params.toString()}`;
}

export function requestErrorCopy(code: string): string {
  return requestErrors[code] ?? "The request failed.";
}

export function messageFromErrorBody(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("error" in parsed) ||
      typeof parsed.error !== "string" ||
      parsed.error.length > 80
    ) {
      return "The request failed.";
    }
    return requestErrorCopy(parsed.error);
  } catch {
    return "The request failed.";
  }
}

export function ingestionStatusLabel(
  status: "pending" | "ready" | "failed",
): string {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "pending") {
    return "Pending";
  }
  return "Failed";
}

export function ingestionErrorCopy(
  status: "pending" | "ready" | "failed",
  reason: string | null,
): string | null {
  if (status !== "failed") {
    return null;
  }
  if (reason === "too_large_for_sync_ingestion") {
    return "This document is too large to index in one request.";
  }
  if (reason === "embedding_not_configured") {
    return "Indexing is not configured.";
  }
  return "Indexing failed.";
}

export function roleLabel(role: StaffRole): string {
  if (role === "knowledge_manager") {
    return "Knowledge manager";
  }
  if (role === "support_agent") {
    return "Support agent";
  }
  if (role === "tenant_admin") {
    return "Tenant admin";
  }
  return "Customer";
}

export function enumLabel(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

export function assignRoleRequest(
  tenantId: string,
  membershipId: string,
  role: StaffRole,
): { url: string; method: "POST"; body: { role: StaffRole } } {
  return {
    url: `/api/v1/tenants/${tenantId}/members/${membershipId}/roles`,
    method: "POST",
    body: { role },
  };
}

export function revokeRoleRequest(
  tenantId: string,
  membershipId: string,
  role: StaffRole,
): { url: string; method: "DELETE" } {
  return {
    url: `/api/v1/tenants/${tenantId}/members/${membershipId}/roles/${role}`,
    method: "DELETE",
  };
}

export function deactivateMemberRequest(
  tenantId: string,
  membershipId: string,
): { url: string; method: "POST" } {
  return {
    url: `/api/v1/tenants/${tenantId}/members/${membershipId}/deactivate`,
    method: "POST",
  };
}

export const buttonClass =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700";

export const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50";

export const fieldClass =
  "rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";
