"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  buttonClass,
  can,
  canSeeInbox,
  enumLabel,
  fieldClass,
  primaryButtonClass,
  withTenant,
  type StaffTenant,
} from "@/staff-ui/access";
import {
  loadTicket,
  postTicketAction,
  postTicketReply,
  type StaffTicket,
} from "@/staff-ui/api";
import { StaffNotice, useStaff } from "@/staff-ui/session";

export function TicketPanel({ ticketId }: { ticketId: string }) {
  const staff = useStaff();
  if (staff.phase !== "ready" || !staff.tenant) {
    return <StaffNotice />;
  }
  if (!canSeeInbox(staff.tenant)) {
    return <p>You cannot view this ticket.</p>;
  }
  return <TicketDesk tenant={staff.tenant} ticketId={ticketId} />;
}

function TicketDesk({
  tenant,
  ticketId,
}: {
  tenant: StaffTenant;
  ticketId: string;
}) {
  const [ticket, setTicket] = useState<StaffTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadTicket(tenant.id, ticketId).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        setTicket(null);
        return;
      }
      setError(null);
      setTicket(result.body);
    });
    return () => {
      cancelled = true;
    };
  }, [tenant.id, ticketId]);

  async function run(
    label: string,
    task: () => Promise<
      { ok: true; body: StaffTicket } | { ok: false; message: string }
    >,
  ) {
    setPending(label);
    setError(null);
    const result = await task();
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTicket(result.body);
  }

  const held =
    ticket?.status === "assigned" || ticket?.status === "in_progress";
  const canClaim =
    can(tenant, "ticket:claim") &&
    (ticket?.status === "open" || ticket?.status === "reopened");
  const canWrite = can(tenant, "ticket:reply") && held;
  const canResolve = can(tenant, "ticket:resolve") && held;

  return (
    <div className="flex flex-col gap-6">
      <Link
        className={buttonClass}
        href={withTenant("/staff/inbox", tenant.id)}
      >
        Back to inbox
      </Link>
      {loading ? <p>Loading ticket.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {ticket ? (
        <>
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-medium">{enumLabel(ticket.reason)}</h2>
            <p role="status">
              {enumLabel(ticket.status)}, {ticket.priority} priority
            </p>
          </header>
          <section className="flex flex-col gap-3" aria-label="Conversation">
            <h3 className="text-lg font-medium">Conversation</h3>
            {ticket.conversation.length === 0 ? (
              <p>No conversation messages.</p>
            ) : null}
            <ol className="flex flex-col gap-3">
              {ticket.conversation.map((message) => (
                <li key={message.id} className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    {message.role === "user" ? "Customer" : "Assistant"}
                    {message.role === "assistant" ? (
                      <span className="ml-2 rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-normal dark:border-zinc-700">
                        AI-generated
                      </span>
                    ) : null}
                  </p>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ol>
          </section>
          {ticket.citations.length > 0 ? (
            <section aria-label="Sources">
              <h3 className="text-lg font-medium">Sources</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {ticket.citations.map((citation) => (
                  <li key={citation.chunkId}>
                    <details className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <summary>
                        {citation.title}
                        {citation.section ? `, ${citation.section}` : ""}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {citation.excerpt}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section
            className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
            aria-label="Customer replies"
          >
            <h3 className="text-lg font-medium">Customer replies</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              The customer can read replies in this section.
            </p>
            {ticket.replies.length === 0 ? <p>No customer replies.</p> : null}
            <ul className="flex flex-col gap-2">
              {ticket.replies.map((entry) => (
                <li key={entry.id} className="whitespace-pre-wrap text-sm">
                  {entry.body}
                </li>
              ))}
            </ul>
          </section>
          <section
            className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
            aria-label="Internal notes"
          >
            <h3 className="text-lg font-medium">Internal notes</h3>
            {can(tenant, "ticket:reply") ? (
              <>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Customers do not see notes in this section.
                </p>
                {ticket.notes.length === 0 ? <p>No internal notes.</p> : null}
                <ul className="flex flex-col gap-2">
                  {ticket.notes.map((entry) => (
                    <li key={entry.id} className="whitespace-pre-wrap text-sm">
                      {entry.body}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                Internal notes stay on the agent view. This access does not
                include them.
              </p>
            )}
          </section>
          <div className="flex flex-col gap-3">
            {canClaim ? (
              <button
                className={primaryButtonClass}
                type="button"
                disabled={pending !== null}
                onClick={() =>
                  void run("claim", () =>
                    postTicketAction(tenant.id, ticket.id, "claim"),
                  )
                }
              >
                {pending === "claim" ? "Claiming ticket." : "Claim ticket"}
              </button>
            ) : null}
            {canWrite ? (
              <>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("note", async () => {
                      const result = await postTicketReply(
                        tenant.id,
                        ticket.id,
                        note.trim(),
                        "internal",
                      );
                      if (result.ok) {
                        setNote("");
                      }
                      return result;
                    });
                  }}
                >
                  <label
                    className="flex flex-col gap-1 text-sm font-medium"
                    htmlFor="internal-note"
                  >
                    Internal note
                    <textarea
                      id="internal-note"
                      className={`min-h-24 ${fieldClass}`}
                      value={note}
                      required
                      maxLength={4000}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  <button
                    className={buttonClass}
                    type="submit"
                    disabled={pending !== null}
                  >
                    {pending === "note" ? "Saving note." : "Add internal note"}
                  </button>
                </form>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run("reply", async () => {
                      const result = await postTicketReply(
                        tenant.id,
                        ticket.id,
                        reply.trim(),
                        "customer",
                      );
                      if (result.ok) {
                        setReply("");
                      }
                      return result;
                    });
                  }}
                >
                  <label
                    className="flex flex-col gap-1 text-sm font-medium"
                    htmlFor="customer-reply"
                  >
                    Customer reply
                    <textarea
                      id="customer-reply"
                      className={`min-h-24 ${fieldClass}`}
                      value={reply}
                      required
                      maxLength={4000}
                      onChange={(event) => setReply(event.target.value)}
                    />
                  </label>
                  <button
                    className={primaryButtonClass}
                    type="submit"
                    disabled={pending !== null}
                  >
                    {pending === "reply"
                      ? "Sending reply."
                      : "Send customer reply"}
                  </button>
                </form>
              </>
            ) : null}
            {canResolve ? (
              <button
                className={buttonClass}
                type="button"
                disabled={pending !== null}
                onClick={() =>
                  void run("resolve", () =>
                    postTicketAction(tenant.id, ticket.id, "resolve"),
                  )
                }
              >
                {pending === "resolve" ? "Resolving ticket." : "Resolve ticket"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
