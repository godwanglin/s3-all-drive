import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/security/encryption";
import { createGoogleOAuthClient } from "./oauth";

type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

export async function getValidAccessToken(accountId: string, userId: string) {
  const cached = tokenCache.get(accountId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const account = await prisma.googleDriveAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error("DRIVE_ACCOUNT_NOT_FOUND");
  const expiresAt = account.tokenExpiresAt?.getTime() || 0;
  if (account.accessToken && expiresAt - 60_000 > Date.now()) {
    tokenCache.set(accountId, { token: account.accessToken, expiresAt });
    return account.accessToken;
  }
  if (!account.refreshToken) throw new Error("DRIVE_NO_REFRESH_TOKEN");
  const client = createGoogleOAuthClient();
  client.setCredentials({ refresh_token: decryptToken(account.refreshToken) });
  const result = await client.getAccessToken();
  if (!result.token) throw new Error("DRIVE_REFRESH_FAILED");
  const nextExpiry = Date.now() + 3_600_000;
  await prisma.googleDriveAccount.update({ where: { id: account.id }, data: { accessToken: result.token, tokenExpiresAt: new Date(nextExpiry) } });
  tokenCache.set(accountId, { token: result.token, expiresAt: nextExpiry });
  return result.token;
}

export async function fetchDriveMediaStream(accountId: string, userId: string, fileId: string, range?: string | null) {
  const token = await getValidAccessToken(accountId, userId);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers, cache: "no-store" });
}
