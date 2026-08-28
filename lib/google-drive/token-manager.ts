import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/security/encryption";
import { createGoogleOAuthClient } from "./oauth";

export async function getGoogleDriveClient(accountId: string, userId: string) {
  const account = await prisma.googleDriveAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error("DRIVE_ACCOUNT_NOT_FOUND");

  const client = createGoogleOAuthClient();
  const refreshToken = account.refreshToken ? decryptToken(account.refreshToken) : undefined;
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiresAt?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    const patch: { accessToken?: string; tokenExpiresAt?: Date; refreshToken?: string } = {};
    if (tokens.access_token) patch.accessToken = tokens.access_token;
    if (tokens.expiry_date) patch.tokenExpiresAt = new Date(tokens.expiry_date);
    if (tokens.refresh_token) patch.refreshToken = encryptRefreshToken(tokens.refresh_token);
    if (Object.keys(patch).length > 0) {
      await prisma.googleDriveAccount.update({ where: { id: account.id }, data: patch });
    }
  });
  return google.drive({ version: "v3", auth: client });
}

export function encryptRefreshToken(token: string) {
  return encryptToken(token);
}
