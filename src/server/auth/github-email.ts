import "server-only";

const emailPattern = /^[^@\s]+@[^@\s]+$/;

export function primaryVerifiedEmail(body: unknown): string | null {
  if (!Array.isArray(body)) {
    return null;
  }
  const primary = body.find(
    (item) =>
      isRecord(item) && item.primary === true && typeof item.email === "string",
  );
  if (!isRecord(primary) || primary.verified !== true) {
    return null;
  }
  if (typeof primary.email !== "string") {
    return null;
  }
  const email = primary.email.trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 320) {
    return null;
  }
  return email;
}

export async function readVerifiedGitHubEmail(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (accessToken.trim() === "") {
    return null;
  }
  try {
    const response = await fetchImpl("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "supportpilot",
      },
    });
    if (!response.ok) {
      return null;
    }
    return primaryVerifiedEmail(await response.json());
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
