"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  buttonClass,
  canSeeInbox,
  enumLabel,
  fieldClass,
  ticketStatuses,
  withTenant,
  type StaffTenant,
} from "@/staff-ui/access";
import { loadTickets, type StaffTicketListItem } from "@/staff-ui/api";
import { StaffNotice, useStaff } from "@/staff-ui/session";

const priorities = ["low", "normal", "high"] as const;

export function InboxPanel() {
  const staff = useStaff();
  if (staff.phase !== "ready" || !staff.tenant) {
    return <StaffNotice />;
  }
  if (!canSeeInbox(staff.tenant)) {
    return <p>You cannot view the inbox.</p>;
  }
  return <InboxDesk tenant={staff.tenant} />;
}

function InboxDesk({ tenant }: { tenant: StaffTenant }) {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [tickets, setTickets] = useState<StaffTicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTickets(tenant.id, { status, priority }).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        setTickets([]);
        return;
      }
      setError(null);
      setTickets(result.body.tickets);
    });
    return () => {
      cancelled = true;
    };
  }, [tenant.id, status, priority]);

  return (
    <section className="flex flex-col gap-4" aria-label="Inbox">
      <h2 className="text-xl font-medium">Inbox</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select
            className={`h-10 ${fieldClass}`}
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value);
            }}
          >
            <option value="">All statuses</option>
            {ticketStatuses.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Priority
          <select
            className={`h-10 ${fieldClass}`}
            value={priority}
            onChange={(event) => {
              setLoading(true);
              setPriority(event.target.value);
            }}
          >
            <option value="">All priorities</option>
            {priorities.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? <p>Loading tickets.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {!loading && !error && tickets.length === 0 ? (
        <p>No tickets match this filter.</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="font-medium">{enumLabel(ticket.reason)}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {enumLabel(ticket.status)}, {ticket.priority} priority
              </p>
            </div>
            <Link
              className={buttonClass}
              href={withTenant(`/staff/inbox/${ticket.id}`, tenant.id)}
            >
              Open ticket
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
