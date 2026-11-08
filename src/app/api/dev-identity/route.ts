import { NextResponse } from "next/server";

import {
  DEV_USER_COOKIE,
  devIdentityCookieOptions,
  devIdentityEnabled,
  isSameOrigin,
  isSeedDevUser,
} from "@/server/auth/dev-identity";

export async function POST(request: Request) {
  if (!devIdentityEnabled(process.env)) {
    return new Response(null, { status: 404 });
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const redirectTo = new URL("/dev/identity", request.url);
  if (form.get("intent") === "clear") {
    const response = NextResponse.redirect(redirectTo, 303);
    response.cookies.set(DEV_USER_COOKIE, "", {
      ...devIdentityCookieOptions(request),
      maxAge: 0,
    });
    return response;
  }

  const userId = form.get("userId");
  if (typeof userId !== "string" || !isSeedDevUser(userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const response = NextResponse.redirect(redirectTo, 303);
  response.cookies.set(
    DEV_USER_COOKIE,
    userId,
    devIdentityCookieOptions(request),
  );
  return response;
}
