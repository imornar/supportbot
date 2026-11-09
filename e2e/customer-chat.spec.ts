import { expect, test, type Route } from "@playwright/test";

const conversationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const assistantMessageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ticketId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const chunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("asks a question, shows a citation, and requests a human", async ({
  page,
}) => {
  const openai: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("api.openai.com")) {
      openai.push(request.url());
    }
  });

  await page.route("**/api/v1/support/messages**", async (route) => {
    const body = route.request().postDataJSON() as { question?: string };
    if (body.question === "I need to talk to a human") {
      await fulfill(route, humanPayload());
      return;
    }
    await fulfill(route, answeredPayload(body.question ?? ""));
  });

  await page.goto("/");
  await expect(
    page.getByText(
      "No messages yet. Ask a question about the published documents.",
    ),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("OPENAI_API_KEY");
  expect(html).not.toContain("postgresql://");
  expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
  expect(html).not.toContain("22222222-2222-4222-8222-222222222222");

  const question = page.getByRole("textbox", { name: "Your question" });
  await question.fill("Where is the packing slip?");
  const messageRequest = page.waitForRequest("**/api/v1/support/messages**");
  await page.getByRole("button", { name: "Send" }).click();
  const sent = await messageRequest;
  expect(new URL(sent.url()).searchParams.has("tenantId")).toBe(false);
  expect(sent.headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByText("Internal notes")).toHaveCount(0);
  await expect(page.getByText("AI-generated")).toBeVisible();
  await expect(page.getByText("The packing slip is in the box.")).toBeVisible();
  await page.getByText("Packing, Slip").click();
  await expect(page.getByText("The slip sits under the lid.")).toBeVisible();

  await page.getByRole("button", { name: "Request a human" }).click();
  const ticket = page.getByRole("status");
  await expect(ticket).toHaveText("Waiting for a support agent.");
  await expect(ticket).not.toContainText(/accepted/i);
  expect(openai).toEqual([]);
});

test("shows abstain copy and keeps a failed request out of the transcript", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/v1/support/messages**", async (route) => {
    calls += 1;
    if (calls === 1) {
      await fulfill(route, abstainedPayload());
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "support_failed" }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Your question" })
    .fill("unknown topic");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(
      "The assistant could not answer from the available documents.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Citations" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Your question" }).fill("again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("The request failed. This is not an answer."),
  ).toBeVisible();
  await expect(page.getByText("AI-generated")).toHaveCount(1);
});

test("shows a loading state until the message route responds", async ({
  page,
}) => {
  await page.route("**/api/v1/support/messages**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fulfill(route, answeredPayload("delayed"));
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Your question" }).fill("delayed");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sending your question.")).toBeVisible();
  await expect(page.getByText("The packing slip is in the box.")).toBeVisible();
});

function answeredPayload(question: string) {
  return {
    conversationId,
    isPrivate: false,
    replayed: false,
    messages: [
      message(userMessageId, "user", question, null, []),
      message(
        assistantMessageId,
        "assistant",
        "The packing slip is in the box.",
        "answered",
        [
          {
            chunkId,
            documentId,
            title: "Packing",
            section: "Slip",
            excerpt: "The slip sits under the lid.",
            documentVersion: 1,
            effectiveDate: null,
          },
        ],
      ),
    ],
    ticket: null,
  };
}

function abstainedPayload() {
  return {
    conversationId,
    isPrivate: false,
    replayed: false,
    messages: [
      message(userMessageId, "user", "unknown topic", null, []),
      message(
        assistantMessageId,
        "assistant",
        "I don't have a document for that.",
        "abstained",
        [],
      ),
    ],
    ticket: null,
  };
}

function humanPayload() {
  return {
    conversationId,
    isPrivate: true,
    replayed: false,
    messages: [
      message(userMessageId, "user", "I need to talk to a human", null, []),
      message(
        assistantMessageId,
        "assistant",
        "You asked for a person. A support agent has not accepted this yet.",
        "escalated",
        [],
      ),
    ],
    ticket: {
      id: ticketId,
      status: "open",
      reason: "customer_requested_human",
      priority: "normal",
    },
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  body: string,
  outcome: "answered" | "abstained" | "escalated" | null,
  citations: unknown[],
) {
  return {
    id,
    role,
    body,
    outcome,
    citations,
    createdAt: "2026-11-09T12:00:00.000Z",
  };
}

async function fulfill(route: Route, payload: unknown) {
  await route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}
