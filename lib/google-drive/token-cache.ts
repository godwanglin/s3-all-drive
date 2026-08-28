import { google, drive_v3 } from "googleapis";
import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/security/encryption";
import { createGoogleOAuthClient } from "./oauth";

type CachedEntry = {
  drive: drive_v3.Drive;
  expiresAt: number;
};

const cache = new Map<string, CachedEntry>();
const REFRESH_MARGIN_MS = 60_000;

export async function getCachedDriveClient(accountId: string, userId: string) {
  const cached = cache.get(accountId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.drive;
  }

  const account = await prisma.googleDriveAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error("DRIVE_ACCOUNT_NOT_FOUND");

  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken ? decryptToken(account.refreshToken) : undefined,
    expiry_date: account.tokenExpiresAt?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    const patch: { accessToken?: string; tokenExpiresAt?: Date; refreshToken?: string } = {};
    if (tokens.access_token) patch.accessToken = tokens.access_token;
    if (tokens.expiry_date) patch.tokenExpiresAt = new Date(tokens.expiry_date);
    if (tokens.refresh_token) patch.refreshToken = encryptToken(tokens.refresh_token);
    if (Object.keys(patch).length > 0) {
      await prisma.googleDriveAccount.update({ where: { id: account.id }, data: patch });
      if (tokens.expiry_date) {
        const entry = cache.get(accountId);
        if (entry) entry.expiresAt = tokens.expiry_date;
      }
    }
  });

  const drive = google.drive({ version: "v3", auth: client });
  cache.set(accountId, {
    drive,
    expiresAt: account.tokenExpiresAt?.getTime() ?? Date.now() + 3600_000,
  });
  return drive;
}

export function invalidateDriveClient(accountId: string) {
  cache.delete(accountId);
}
