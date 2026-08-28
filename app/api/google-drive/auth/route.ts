import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getGoogleAuthorizationUrl } from "@/lib/google-drive/oauth";
import { errorResponse, successResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  const format = request.nextUrl.searchParams.get("format");
  if (!user) {
    if (format === "json") return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
    return NextResponse.redirect(new URL("/api/auth/signin", process.env.NEXTAUTH_URL));
  }
  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("google-drive-oauth-state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  const authUrl = getGoogleAuthorizationUrl(state);
  if (format === "json") return successResponse({ url: authUrl });
  return NextResponse.redirect(authUrl);
}
