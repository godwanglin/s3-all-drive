import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, successResponse } from "@/lib/api-response";
import { redeemOAuthHandoff } from "@/lib/google-drive/oauth-handoff";
import { encryptRefreshToken } from "@/lib/google-drive/token-manager";

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  try {
    const body = await request.json() as { token?: string };
    const token = body.token?.trim();
    if (!token) return errorResponse("INVALID_TOKEN", "Callback token is required.", 400);
    const payload = redeemOAuthHandoff(token);
    if (!payload) return errorResponse("EXPIRED_TOKEN", "Token is invalid or expired.", 400);

    const where = { userId_googleAccountId: { userId: user.id, googleAccountId: payload.googleAccountId } };
    const existing = await prisma.googleDriveAccount.findUnique({ where });
    const account = await prisma.googleDriveAccount.upsert({
      where,
      create: {
        userId: user.id, googleAccountId: payload.googleAccountId, email: payload.email,
        name: payload.name, picture: payload.picture, accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ? encryptRefreshToken(payload.refreshToken) : null,
        tokenExpiresAt: payload.tokenExpiresAt,
      },
      update: {
        email: payload.email, name: payload.name, picture: payload.picture, accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ? encryptRefreshToken(payload.refreshToken) : existing?.refreshToken,
        tokenExpiresAt: payload.tokenExpiresAt,
      },
    });
    return successResponse({ account: { id: account.id, email: account.email, name: account.name } });
  } catch (error) {
    console.error("CONNECT_TOKEN_FAILED:", error);
    return errorResponse("CONNECT_TOKEN_FAILED", "Failed to connect Google Drive with token.", 500);
  }
}
