import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export interface ApiKeyContext {
  keyId: string;
  ownerId: string;
  bucketId: string;
  permissions: string[];
  name: string;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey() {
  const rawKey = `sk_live_redacted_example(24).toString("hex")}`;
  return { rawKey, keyPrefix: rawKey.slice(0, 16), keyHash: hashApiKey(rawKey) };
}

export function hasPermission(granted: string[], required: string) {
  if (granted.includes("*") || granted.includes("admin") || granted.includes(required)) return true;
  const [resource, action] = required.split(":");
  return granted.includes(`${resource}:*`) || granted.includes(`*:${action}`);
}

export async function authenticateApiKey(authHeader: string | null): Promise<ApiKeyContext | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash: hashApiKey(authHeader.slice(7).trim()), status: "ACTIVE" },
    include: { bucket: true },
  });
  if (!apiKey || !apiKey.bucket?.isActive) return null;
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now()) {
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { status: "EXPIRED" } });
    return null;
  }
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  return { keyId: apiKey.id, ownerId: apiKey.ownerId, bucketId: apiKey.bucketId, permissions: Array.isArray(apiKey.permissions) ? (apiKey.permissions as string[]) : [], name: apiKey.name };
}

export type AuthResult =
  | { error: string; status: number }
  | { ownerId: string; bucketId: string; context: ApiKeyContext; user?: undefined }
  | { ownerId: string; bucketId: undefined; user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>; context?: undefined };

export async function getSessionOrApiKey(request: Request, permission?: string): Promise<AuthResult> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = await authenticateApiKey(authHeader);
    if (!apiKey) return { error: "INVALID_OR_EXPIRED_API_KEY", status: 401 };
    if (permission && !hasPermission(apiKey.permissions, permission)) return { error: "FORBIDDEN_PERMISSION_DENIED", status: 403 };
    return { ownerId: apiKey.ownerId, bucketId: apiKey.bucketId, context: apiKey };
  }
  const user = await getAuthUser();
  if (!user) return { error: "UNAUTHORIZED", status: 401 };
  return { ownerId: user.id, bucketId: undefined, user };
}
