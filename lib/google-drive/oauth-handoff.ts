import { randomUUID } from "crypto";

interface HandoffPayload {
  googleAccountId: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  expiresAt: number;
}

const handoffs = new Map<string, HandoffPayload>();
const TTL = 10 * 60 * 1000;

export function createOAuthHandoff(payload: Omit<HandoffPayload, "expiresAt">) {
  const token = randomUUID();
  handoffs.set(token, { ...payload, expiresAt: Date.now() + TTL });
  return token;
}

export function redeemOAuthHandoff(token: string) {
  const payload = handoffs.get(token);
  handoffs.delete(token);
  if (!payload || payload.expiresAt < Date.now()) return undefined;
  return payload;
}

