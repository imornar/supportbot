"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  assignRoleRequest,
  buttonClass,
  can,
  canSeeAdmin,
  deactivateMemberRequest,
  fieldClass,
  primaryButtonClass,
  revokeRoleRequest,
  roleLabel,
  roleNames,
  type StaffTenant,
} from "@/staff-ui/access";
import {
  loadAudit,
  loadMembers,
  loadSettings,
  saveSettings,
  sendMemberRequest,
  type StaffAuditEvent,
  type StaffMember,
} from "@/staff-ui/api";
import { StaffNotice, useStaff } from "@/staff-ui/session";

export function AdminPanel() {
  const staff = useStaff();
  if (staff.phase !== "ready" || !staff.tenant) {
    return <StaffNotice />;
  }
  if (!canSeeAdmin(staff.tenant)) {
    return <p>You cannot administer this tenant.</p>;
  }
  return <AdminDesk tenant={staff.tenant} />;
}

function AdminDesk({ tenant }: { tenant: StaffTenant }) {
  return (
    <div className="flex flex-col gap-8">
      {can(tenant, "tenant:user:manage") ? (
        <Members tenantId={tenant.id} />
      ) : null}
      {can(tenant, "tenant:settings:manage") ? (
        <Settings tenantId={tenant.id} />
      ) : null}
      {can(tenant, "audit:read") ? <Audit tenantId={tenant.id} /> : null}
    </div>
  );
}

function Members({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMembers(tenantId).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMembers(result.body.members);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function change(
    key: string,
    request: {
      url: string;
      method: "POST" | "DELETE";
      body?: unknown;
    },
  ) {
    setPending(key);
    setError(null);
    const result = await sendMemberRequest(request);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMembers((current) =>
      current.map((member) =>
        member.membershipId === result.body.member.membershipId
          ? result.body.member
          : member,
      ),
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Members">
      <h2 className="text-xl font-medium">Members</h2>
      {loading ? <p>Loading members.</p> : null}
      {error ? <Alert message={error} /> : null}
      {!loading && members.length === 0 ? <p>No members.</p> : null}
      <ul className="flex flex-col gap-3">
        {members.map((member) => (
          <li
            key={member.membershipId}
            className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div>
              <p className="font-medium">{member.displayName}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {member.email}
              </p>
              <p className="text-sm">
                {member.status === "active" ? "Active" : "Deactivated"}
              </p>
            </div>
            {member.status === "active" ? (
              <div className="flex flex-col gap-2">
                {roleNames.map((role) => {
                  const held = member.roles.includes(role);
                  const request = held
                    ? revokeRoleRequest(tenantId, member.membershipId, role)
                    : assignRoleRequest(tenantId, member.membershipId, role);
                  const key = `${member.membershipId}:${role}`;
                  return (
                    <button
                      key={role}
                      className={buttonClass}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void change(key, request)}
                    >
                      {pending === key
                        ? "Saving role."
                        : `${held ? "Revoke" : "Assign"} ${roleLabel(role)}`}
                    </button>
                  );
                })}
                <button
                  className={buttonClass}
                  type="button"
                  disabled={pending !== null}
                  onClick={() =>
                    void change(
                      `${member.membershipId}:deactivate`,
                      deactivateMemberRequest(tenantId, member.membershipId),
                    )
                  }
                >
                  {pending === `${member.membershipId}:deactivate`
                    ? "Deactivating membership."
                    : "Deactivate membership"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Settings({ tenantId }: { tenantId: string }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSettings(tenantId).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName(result.body.publicSupportName);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    const result = await saveSettings(tenantId, name.trim());
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setName(result.body.publicSupportName);
    setSaved(true);
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Tenant settings">
      <h2 className="text-xl font-medium">Settings</h2>
      {loading ? <p>Loading settings.</p> : null}
      {error ? <Alert message={error} /> : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <label
          className="flex max-w-md flex-col gap-1 text-sm font-medium"
          htmlFor="support-name"
        >
          Public support name
          <input
            id="support-name"
            className={fieldClass}
            value={name}
            required
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          className={primaryButtonClass}
          type="submit"
          disabled={pending || loading}
        >
          {pending ? "Saving settings." : "Save settings"}
        </button>
        {saved ? <p role="status">Saved the public support name.</p> : null}
      </form>
    </section>
  );
}

function Audit({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<StaffAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAudit(tenantId).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEvents(result.body.events);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <section className="flex flex-col gap-3" aria-label="Audit events">
      <h2 className="text-xl font-medium">Audit</h2>
      {loading ? <p>Loading audit events.</p> : null}
      {error ? <Alert message={error} /> : null}
      {!loading && events.length === 0 ? <p>No audit events.</p> : null}
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="rounded-2xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <p className="font-medium">{event.action}</p>
            <p className="text-zinc-600 dark:text-zinc-400">
              {event.targetType} {event.targetId}
            </p>
            <p className="text-zinc-500">
              {event.createdAt} by {event.actorUserId}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Alert({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-red-800 dark:text-red-200">
      {message}
    </p>
  );
}
