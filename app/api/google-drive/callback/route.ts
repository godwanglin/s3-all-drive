import { getCallbackPageHtml } from "@/lib/google-drive/callback-template";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createGoogleOAuthClient } from "@/lib/google-drive/oauth";
import { encryptRefreshToken } from "@/lib/google-drive/token-manager";
import { createOAuthHandoff } from "@/lib/google-drive/oauth-handoff";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const googleError = url.searchParams.get("error");
  if (googleError) {
    return NextResponse.redirect(
      new URL(`/?drive_error=${encodeURIComponent(googleError)}`, request.url)
    );
  }

  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("google-drive-oauth-state")?.value;
    const user = await getAuthUser();
    cookieStore.delete("google-drive-oauth-state");

    if (!code) return NextResponse.redirect(new URL("/?drive_error=missing_code", request.url));

  const oauthClient = createGoogleOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

  const oauth2 = await import("googleapis").then(({ google }) => google.oauth2({ version: "v2", auth: oauthClient }));
  const profile = await oauth2.userinfo.get();
  const googleAccountId = profile.data.id;
  const email = profile.data.email;

  if (!googleAccountId || !email || !tokens.access_token) {
    return NextResponse.redirect(new URL("/?drive_error=profile_failed", request.url));
  }

  if (!user || !state || state !== expectedState) {
    const handoffToken = createOAuthHandoff({
      googleAccountId,
      email,
      name: profile.data.name,
      picture: profile.data.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
    return new NextResponse(getCallbackPageHtml(handoffToken), { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const existing = await prisma.googleDriveAccount.findUnique({
    where: { userId_googleAccountId: { userId: user.id, googleAccountId } },
  });

  await prisma.googleDriveAccount.upsert({
    where: { userId_googleAccountId: { userId: user.id, googleAccountId } },
    create: {
      userId: user.id,
      googleAccountId,
      email,
      name: profile.data.name,
      picture: profile.data.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ? encryptRefreshToken(tokens.refresh_token) : null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      email,
      name: profile.data.name,
      picture: profile.data.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ? encryptRefreshToken(tokens.refresh_token) : existing?.refreshToken,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

    return NextResponse.redirect(new URL("/?drive_connected=1", request.url));
  } catch (error) {
    console.error("Google Drive callback failed:", error);
    return NextResponse.redirect(new URL("/?drive_error=callback_failed", request.url));
  }
}
