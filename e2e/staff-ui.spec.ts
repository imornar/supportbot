import { expect, test, type Page, type Route } from "@playwright/test";

const tenantId = "11111111-1111-4111-8111-111111111111";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ticketId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const conversationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userId = "10000000-0000-4000-8000-000000000003";
const messageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const noteId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const replyId = "abababab-abab-4aba-8aba-abababababab";

const customerPermissions = [
  "conversation:read",
  "conversation:create",
  "order:read",
  "ticket:read",
];

const knowledgePermissions = [
  "document:read",
  "document:create",
  "document:update",
  "document:retire",
];

const agentPermissions = [
  "ticket:read",
  "ticket:claim",
  "ticket:reply",
  "ticket:resolve",
];

test("a customer session has no upload control", async ({ page }) => {
  const documentCalls: string[] = [];
  await session(page, customerPermissions);
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/documents")) {
      documentCalls.push(request.method());
    }
  });
  await page.goto("/staff/documents");
  await expect(page.getByText("You cannot view documents.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload document" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Document content")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Knowledge" })).toHaveCount(0);
  expect(documentCalls).toEqual([]);
});

test("uploads a document and shows a ready fixture", async ({ page }) => {
  await session(page, knowledgePermissions);
  let documents: ReturnType<typeof documentFixture>[] = [];
  await page.route("**/api/v1/documents**", async (route) => {
    if (route.request().method() === "GET") {
      await fulfill(route, { documents });
      return;
    }
    const body = route.request().postDataJSON() as { title?: string };
    documents = [
      documentFixture({
        title: body.title ?? "Packing",
        ingestionStatus: "ready",
        failureReason: null,
      }),
    ];
    await fulfill(route, { document: documents[0], created: true }, 201);
  });

  await page.goto("/staff/documents");
  await expect(page.getByText("No documents yet.")).toBeVisible();
  await page.getByLabel("Title").fill("Packing");
  await page.getByLabel("Source").fill("packing.md");
  await page
    .getByLabel("Document content")
    .fill("The slip sits under the lid.");
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Packing", { exact: true })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("sk-test-key");
  expect(html).not.toContain("SECRET_BODY");
});

test("shows a readable ingestion error and hides raw failure text", async ({
  page,
}) => {
  await session(page, knowledgePermissions);
  await page.route("**/api/v1/documents**", async (route) => {
    await fulfill(route, {
      documents: [
        documentFixture({
          ingestionStatus: "failed",
          failureReason: "embedding_failed",
        }),
      ],
    });
  });
  await page.goto("/staff/documents");
  await expect(page.getByText("Indexing failed.")).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("sk-test-key");
  expect(html).not.toContain("SECRET_BODY");
});

test("does not render a stack or a key from a failed document response", async ({
  page,
}) => {
  await session(page, knowledgePermissions);
  await page.route("**/api/v1/documents**", async (route) => {
    await fulfill(
      route,
      {
        error: "Error: sk-live at handler",
        stack: "Error: sk-live\n    at ingest",
      },
      500,
    );
  });
  await page.goto("/staff/documents");
  await expect(
    page.getByText("The request failed.", { exact: true }),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("sk-live");
  expect(html).not.toContain("at ingest");
});

test("claims, notes, replies, and resolves a ticket", async ({ page }) => {
  await session(page, agentPermissions);
  const ticket = {
    id: ticketId,
    conversationId,
    requesterUserId: "10000000-0000-4000-8000-000000000004",
    reason: "customer_requested_human",
    priority: "normal" as const,
    status: "open" as "open" | "assigned" | "in_progress" | "resolved",
    assigneeUserId: null as string | null,
    claimedAt: null as string | null,
    resolvedAt: null as string | null,
    createdAt: "2026-11-09T12:00:00.000Z",
    updatedAt: "2026-11-09T12:00:00.000Z",
    citations: [],
    replies: [] as {
      id: string;
      body: string;
      createdAt: string;
      authorUserId: string;
    }[],
    notes: [] as {
      id: string;
      body: string;
      createdAt: string;
      authorUserId: string;
    }[],
    conversation: [
      {
        id: messageId,
        role: "user" as const,
        body: "I need a person.",
        createdAt: "2026-11-09T12:00:00.000Z",
      },
    ],
  };

  await page.route("**/api/v1/tickets**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    expect(url.searchParams.get("tenantId")).toBe(tenantId);
    if (url.pathname.endsWith("/claim") && method === "POST") {
      ticket.status = "assigned";
      ticket.assigneeUserId = userId;
      ticket.claimedAt = "2026-11-09T12:05:00.000Z";
      await fulfill(route, ticket);
      return;
    }
    if (url.pathname.endsWith("/replies") && method === "POST") {
      const body = route.request().postDataJSON() as {
        body: string;
        visibility: string;
      };
      const entry = {
        id: body.visibility === "internal" ? noteId : replyId,
        body: body.body,
        createdAt: "2026-11-09T12:06:00.000Z",
        authorUserId: userId,
      };
      if (body.visibility === "internal") {
        ticket.notes = [entry];
      } else {
        ticket.replies = [entry];
        ticket.status = "in_progress";
      }
      await fulfill(route, ticket);
      return;
    }
    if (url.pathname.endsWith("/resolve") && method === "POST") {
      ticket.status = "resolved";
      ticket.resolvedAt = "2026-11-09T12:07:00.000Z";
      await fulfill(route, ticket);
      return;
    }
    if (url.pathname === "/api/v1/tickets") {
      await fulfill(route, {
        tickets: [
          {
            id: ticket.id,
            conversationId: ticket.conversationId,
            requesterUserId: ticket.requesterUserId,
            reason: ticket.reason,
            priority: ticket.priority,
            status: ticket.status,
            assigneeUserId: ticket.assigneeUserId,
            claimedAt: ticket.claimedAt,
            resolvedAt: ticket.resolvedAt,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
          },
        ],
      });
      return;
    }
    await fulfill(route, ticket);
  });

  await page.goto(`/staff/inbox?tenantId=${tenantId}`);
  await page.getByRole("link", { name: "Open ticket" }).click();
  await expect(page.getByText("I need a person.")).toBeVisible();
  await page.getByRole("button", { name: "Claim ticket" }).click();
  await page
    .getByRole("textbox", { name: "Internal note", exact: true })
    .fill("Agent only");
  await page.getByRole("button", { name: "Add internal note" }).click();
  const notes = page.getByRole("region", { name: "Internal notes" });
  const replies = page.getByRole("region", { name: "Customer replies" });
  await expect(notes).toContainText("Agent only");
  await expect(replies).not.toContainText("Agent only");
  await page
    .getByRole("textbox", { name: "Customer reply", exact: true })
    .fill("Hello customer");
  await page.getByRole("button", { name: "Send customer reply" }).click();
  await expect(replies).toContainText("Hello customer");
  await expect(notes).not.toContainText("Hello customer");
  await page.getByRole("button", { name: "Resolve ticket" }).click();
  await expect(page.getByRole("status")).toContainText("Resolved");
});

test("shows an empty inbox without treating an error as a ticket", async ({
  page,
}) => {
  await session(page, agentPermissions);
  let calls = 0;
  await page.route("**/api/v1/tickets**", async (route) => {
    calls += 1;
    if (calls === 1) {
      await fulfill(route, { tickets: [] });
      return;
    }
    await fulfill(
      route,
      { error: "ticket_failed", stack: "Error: sk-queue" },
      500,
    );
  });
  await page.goto("/staff/inbox");
  await expect(page.getByText("No tickets match this filter.")).toBeVisible();
  await page.getByLabel("Status").selectOption("open");
  await expect(
    page.getByText("The request failed.", { exact: true }),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("sk-queue");
});

async function session(page: Page, permissions: string[]) {
  await page.route("**/api/v1/staff/session", async (route) => {
    await fulfill(route, {
      tenants: [{ id: tenantId, name: "Harbor Goods", permissions }],
    });
  });
}

function documentFixture(overrides: Record<string, unknown>) {
  return {
    id: documentId,
    tenantId,
    title: "Packing",
    source: "packing.md",
    documentType: "markdown",
    version: 1,
    publication: "draft",
    ingestionStatus: "ready",
    failureReason: null,
    checksum: "sk-test-key",
    isCurrent: true,
    supersedesDocumentId: null,
    effectiveDate: null,
    uploadedByUserId: "10000000-0000-4000-8000-000000000002",
    createdAt: "2026-11-09T12:00:00.000Z",
    updatedAt: "2026-11-09T12:00:00.000Z",
    retiredAt: null,
    body: "SECRET_BODY",
    ...overrides,
  };
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
