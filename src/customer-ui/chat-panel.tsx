"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

import {
  appendTurn,
  assistantOutcomeCopy,
  humanRequestQuestion,
  postSupportMessage,
  readTicket,
  ticketStatusCopy,
  type ChatMessage,
  type CustomerTicketView,
  type TicketSummary,
} from "@/customer-ui/messages";
import type { CustomerChatViewer } from "@/customer-ui/types";

const questionLimit = 2_000;

type TicketState = {
  summary: TicketSummary;
  detail: CustomerTicketView | null;
};

export function CustomerChat({ viewer }: { viewer: CustomerChatViewer }) {
  const [tenantId, setTenantId] = useState(
    viewer.kind === "signed_in" ? (viewer.tenants[0]?.id ?? "") : "",
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketState | null>(null);
  const [humanRequested, setHumanRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"message" | "ticket" | null>(null);

  const signedIn = viewer.kind === "signed_in";
  const canAsk =
    viewer.kind === "anonymous" ||
    (signedIn && viewer.tenants.length > 0 && tenantId.length > 0);
  const selectedTenant =
    signedIn && tenantId
      ? (viewer.tenants.find((tenant) => tenant.id === tenantId) ?? null)
      : null;

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending || !canAsk) {
      return;
    }
    setPending("message");
    setError(null);
    const result = await postSupportMessage({
      tenantId: signedIn ? tenantId : null,
      question: trimmed,
      conversationId: signedIn ? conversationId : null,
    });
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConversationId(result.body.conversationId);
    setMessages((current) => appendTurn(current, result.body.messages));
    if (result.body.ticket) {
      setTicket({ summary: result.body.ticket, detail: null });
      setHumanRequested(true);
    }
    if (trimmed === humanRequestQuestion) {
      setHumanRequested(true);
    }
    setDraft("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendQuestion(draft);
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion(draft);
    }
  }

  async function refreshTicket() {
    if (!ticket || !signedIn || !tenantId || pending) {
      return;
    }
    setPending("ticket");
    setError(null);
    const result = await readTicket({
      ticketId: ticket.summary.id,
      tenantId,
    });
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTicket({
      summary: {
        id: result.ticket.id,
        status: result.ticket.status,
        reason: result.ticket.reason,
        priority: result.ticket.priority,
      },
      detail: result.ticket,
    });
  }

  return (
    <section className="flex flex-1 flex-col gap-4" aria-label="Customer chat">
      <ViewerNotice viewer={viewer} tenantName={selectedTenant?.name ?? null} />
      {signedIn && viewer.tenants.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Company
          <select
            className="h-10 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
            value={tenantId}
            onChange={(event) => {
              setTenantId(event.target.value);
              setMessages([]);
              setConversationId(null);
              setTicket(null);
              setHumanRequested(false);
              setError(null);
            }}
          >
            {viewer.tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div
        className="flex min-h-64 flex-1 flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
        aria-busy={pending !== null}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No messages yet. Ask a question about the published documents.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </ol>
        )}
        {pending === "message" ? <p>Sending your question.</p> : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="question"
        >
          Your question
          <textarea
            id="question"
            name="question"
            className="min-h-24 rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700"
            maxLength={questionLimit}
            value={draft}
            required
            disabled={!canAsk || pending !== null}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onQuestionKeyDown}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            type="submit"
            disabled={!canAsk || pending !== null || draft.trim().length === 0}
          >
            Send
          </button>
          <button
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
            type="button"
            disabled={!canAsk || pending !== null}
            onClick={() => void sendQuestion(humanRequestQuestion)}
          >
            Request a human
          </button>
        </div>
        <p className="text-sm text-zinc-500">
          Enter sends. Shift+Enter adds a line.
        </p>
      </form>

      <TicketStatus
        ticket={ticket}
        humanRequested={humanRequested}
        signedIn={signedIn}
        pending={pending === "ticket"}
        onRefresh={() => void refreshTicket()}
      />
    </section>
  );
}

function ViewerNotice({
  viewer,
  tenantName,
}: {
  viewer: CustomerChatViewer;
  tenantName: string | null;
}) {
  if (viewer.kind === "unavailable") {
    return (
      <p role="alert">
        Support is unavailable right now. Nothing has been answered.
      </p>
    );
  }
  if (viewer.kind === "rejected") {
    return (
      <p role="alert">
        This development identity is not accepted. Clear it before asking a
        question.
      </p>
    );
  }
  if (viewer.kind === "signed_in" && viewer.tenants.length === 0) {
    return (
      <p>
        This account cannot ask questions. Sign in with a customer membership to
        use the chat.
      </p>
    );
  }
  if (viewer.kind === "signed_in" && tenantName) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Asking as a customer of {tenantName}. Answers are generated on the
        server.
      </p>
    );
  }
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Asking without an account. Answers use the public documents. A human
      request is not tracked on a ticket until you sign in.
    </p>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const outcome = assistantOutcomeCopy(message.outcome);
  const speaker = message.role === "user" ? "You" : "Assistant";
  return (
    <li className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {speaker}
        {message.role === "assistant" ? (
          <span className="ml-2 rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-normal dark:border-zinc-700">
            AI-generated
          </span>
        ) : null}
      </p>
      {outcome ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{outcome}</p>
      ) : null}
      <p className="whitespace-pre-wrap">{message.body}</p>
      {message.citations.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Citations">
          {message.citations.map((citation) => (
            <li key={citation.chunkId}>
              <details className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <summary>
                  {citation.title}
                  {citation.section ? `, ${citation.section}` : ""}
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {citation.excerpt}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Version {citation.documentVersion}
                  {citation.effectiveDate
                    ? `, effective ${citation.effectiveDate}`
                    : ""}
                </p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TicketStatus({
  ticket,
  humanRequested,
  signedIn,
  pending,
  onRefresh,
}: {
  ticket: TicketState | null;
  humanRequested: boolean;
  signedIn: boolean;
  pending: boolean;
  onRefresh: () => void;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
      aria-label="Ticket status"
    >
      <h2 className="text-lg font-medium">Human support</h2>
      {!ticket && !humanRequested ? <p>No human request yet.</p> : null}
      {!ticket && humanRequested ? (
        <p role="status">
          No ticket was opened. Sign in with a customer account to track a
          request. A person has not taken it.
        </p>
      ) : null}
      {ticket ? (
        <>
          <p role="status">{ticketStatusCopy(ticket.summary.status)}</p>
          <p className="font-mono text-sm text-zinc-500">
            Status {ticket.summary.status}
          </p>
          {ticket.detail && ticket.detail.replies.length > 0 ? (
            <ul
              className="flex flex-col gap-2"
              aria-label="Replies from support"
            >
              {ticket.detail.replies.map((reply) => (
                <li key={reply.id} className="whitespace-pre-wrap text-sm">
                  {reply.body}
                </li>
              ))}
            </ul>
          ) : null}
          {signedIn ? (
            <button
              className="inline-flex h-10 w-fit items-center rounded-full border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
              type="button"
              onClick={onRefresh}
              disabled={pending}
            >
              {pending ? "Refreshing status." : "Refresh status"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
