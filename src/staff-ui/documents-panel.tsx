"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  fieldClass,
  ingestionErrorCopy,
  ingestionStatusLabel,
  primaryButtonClass,
  uploadControlVisible,
  type StaffTenant,
} from "@/staff-ui/access";
import {
  createDocument,
  loadDocuments,
  type StaffDocument,
} from "@/staff-ui/api";
import { StaffNotice, useStaff } from "@/staff-ui/session";

export function DocumentsPanel() {
  const staff = useStaff();
  const notice = <StaffNotice />;
  if (staff.phase !== "ready" || !staff.tenant) {
    return notice;
  }
  if (!staff.tenant.permissions.includes("document:read")) {
    return <p>You cannot view documents.</p>;
  }
  return <DocumentDesk tenant={staff.tenant} />;
}

function DocumentDesk({ tenant }: { tenant: StaffTenant }) {
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [documentType, setDocumentType] = useState<"markdown" | "text">(
    "markdown",
  );
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const canUpload = uploadControlVisible(tenant);

  useEffect(() => {
    let cancelled = false;
    void loadDocuments(tenant.id).then((result) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        setDocuments([]);
        return;
      }
      setError(null);
      setDocuments(result.body.documents);
    });
    return () => {
      cancelled = true;
    };
  }, [tenant.id]);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpload || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await createDocument({
      tenantId: tenant.id,
      title: title.trim(),
      source: source.trim(),
      documentType,
      content,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const created = result.body.document;
    setDocuments((current) => [
      created,
      ...current.filter((document) => document.id !== created.id),
    ]);
    setTitle("");
    setSource("");
    setContent("");
    const listed = await loadDocuments(tenant.id);
    if (listed.ok) {
      setDocuments(listed.body.documents);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-label="Documents">
        <h2 className="text-xl font-medium">Documents</h2>
        {loading ? <p>Loading documents.</p> : null}
        {error ? <Alert message={error} /> : null}
        {!loading && !error && documents.length === 0 ? (
          <p>No documents yet.</p>
        ) : null}
        {documents.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {documents.map((document) => (
              <DocumentRow key={document.id} document={document} />
            ))}
          </ul>
        ) : null}
      </section>
      {canUpload ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => void onUpload(event)}
        >
          <h2 className="text-xl font-medium">Upload</h2>
          <label
            className="flex flex-col gap-1 text-sm font-medium"
            htmlFor="title"
          >
            Title
            <input
              id="title"
              className={fieldClass}
              value={title}
              required
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-sm font-medium"
            htmlFor="source"
          >
            Source
            <input
              id="source"
              className={fieldClass}
              value={source}
              required
              maxLength={500}
              onChange={(event) => setSource(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-sm font-medium"
            htmlFor="document-type"
          >
            Document type
            <select
              id="document-type"
              className={`h-10 ${fieldClass}`}
              value={documentType}
              onChange={(event) =>
                setDocumentType(
                  event.target.value === "text" ? "text" : "markdown",
                )
              }
            >
              <option value="markdown">Markdown</option>
              <option value="text">Plain text</option>
            </select>
          </label>
          <label
            className="flex flex-col gap-1 text-sm font-medium"
            htmlFor="content"
          >
            Document content
            <textarea
              id="content"
              className={`min-h-32 ${fieldClass}`}
              value={content}
              required
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <button
            className={primaryButtonClass}
            type="submit"
            disabled={pending}
          >
            {pending ? "Uploading document." : "Upload document"}
          </button>
        </form>
      ) : (
        <p>
          You can view documents. Upload stays on the knowledge manager role.
        </p>
      )}
    </div>
  );
}

function DocumentRow({ document }: { document: StaffDocument }) {
  const failure = ingestionErrorCopy(
    document.ingestionStatus,
    document.failureReason,
  );
  return (
    <li className="flex flex-col gap-1 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-medium">{document.title}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {document.source}
      </p>
      <p>
        <span className="text-sm font-medium">Ingestion </span>
        <span role="status">
          {ingestionStatusLabel(document.ingestionStatus)}
        </span>
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {document.publication}, version {document.version}
      </p>
      {failure ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {failure}
        </p>
      ) : null}
    </li>
  );
}

function Alert({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:text-red-200"
    >
      {message}
    </p>
  );
}
