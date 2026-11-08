import { describe, expect, it } from "vitest";
import {
  primaryVerifiedEmail,
  readVerifiedGitHubEmail,
} from "@/server/auth/github-email";
import { selectLinkTarget } from "@/server/auth/provider-link";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "ada@harbor.example",
  authProvider: null,
  authSubject: null,
};

describe("primaryVerifiedEmail", () => {
  it("returns the lowercase primary email only when GitHub marks it verified", () => {
    expect(
      primaryVerifiedEmail([
        { email: "Ada@Harbor.example", primary: true, verified: true },
        { email: "other@harbor.example", primary: false, verified: true },
      ]),
    ).toBe("ada@harbor.example");
  });

  it("refuses an unverified primary email and a non-array body", () => {
    expect(
      primaryVerifiedEmail([
        { email: "ada@harbor.example", primary: true, verified: false },
      ]),
    ).toBeNull();
    expect(primaryVerifiedEmail({ message: "nope" })).toBeNull();
  });
});

describe("readVerifiedGitHubEmail", () => {
  it("reads the emails API and does not return the access token", async () => {
    const token = "ghp-planted-access-token";
    let authorization = "";
    const email = await readVerifiedGitHubEmail(token, async (_url, init) => {
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") ?? "";
      return Response.json([
        { email: "Ada@Harbor.example", primary: true, verified: true },
      ]);
    });
    expect(email).toBe("ada@harbor.example");
    expect(authorization).toBe(`Bearer ${token}`);
    expect(email).not.toContain(token);
  });

  it("returns null when GitHub refuses the request", async () => {
    await expect(
      readVerifiedGitHubEmail(
        "token",
        async () => new Response(null, { status: 401 }),
      ),
    ).resolves.toBeNull();
  });
});

describe("selectLinkTarget", () => {
  it("attaches a subject to a user who has none", () => {
    expect(
      selectLinkTarget([user], {
        provider: "github",
        subject: "44",
        email: "Ada@Harbor.example",
      }),
    ).toEqual({ action: "attach", userId: user.id });
  });

  it("recognizes an existing subject without using email", () => {
    expect(
      selectLinkTarget(
        [{ ...user, authProvider: "github", authSubject: "44" }],
        { provider: "github", subject: "44", email: null },
      ),
    ).toEqual({ action: "already" });
  });

  it("refuses a second subject on an email that is already linked", () => {
    expect(
      selectLinkTarget(
        [{ ...user, authProvider: "github", authSubject: "44" }],
        { provider: "github", subject: "99", email: user.email },
      ),
    ).toEqual({ action: "refuse" });
  });

  it("refuses when no verified email and no subject match", () => {
    expect(
      selectLinkTarget([user], {
        provider: "github",
        subject: "44",
        email: null,
      }),
    ).toEqual({ action: "refuse" });
  });
});
