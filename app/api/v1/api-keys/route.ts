import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/storage-api/auth";
import { encryptToken } from "@/lib/security/encryption";
import { generateS3Secret } from "@/lib/storage-api/s3-auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const bucketId = request.nextUrl.searchParams.get("bucketId");
  const keys = await (prisma as any).apiKey.findMany({
    where: {
      ownerId: user.id,
      ...(bucketId ? { bucketId } : {}),
    },
    include: { bucket: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });
  return successResponse({
    api_keys: keys.map((key: any) => ({
      id: key.id,
      name: key.name,
      bucket_id: key.bucketId,
      bucket_name: key.bucket?.name,
      key_prefix: key.keyPrefix,
      permissions: key.permissions,
      status: key.status,
      expires_at: key.expiresAt,
      last_used_at: key.lastUsedAt,
      created_at: key.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const bucketId = String(body.bucket_id || "").trim();
  const permissions = Array.isArray(body.permissions) ? body.permissions : [];
  if (!name || !bucketId || permissions.length === 0) {
    return errorResponse("VALIDATION_ERROR", "Name, bucket_id, and at least one permission are required.", 400);
  }
  const bucket = await (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId: user.id } });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Selected bucket does not exist.", 404);
  const { rawKey, keyPrefix, keyHash } = generateApiKey();
  const s3Secret = generateS3Secret();
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
  const apiKey = await (prisma as any).apiKey.create({
    data: {
      ownerId: user.id,
      bucketId,
      name,
      keyPrefix,
      keyHash,
      secretEncrypted: encryptToken(s3Secret),
      permissions,
      expiresAt,
    },
  });
  return successResponse(
    {
      id: apiKey.id,
      name: apiKey.name,
      bucket_id: apiKey.bucketId,
      permissions: apiKey.permissions,
      key_prefix: apiKey.keyPrefix,
      raw_key: rawKey,
      s3_access_key_id: apiKey.keyPrefix,
      s3_secret_access_key: s3Secret,
      expires_at: apiKey.expiresAt,
      created_at: apiKey.createdAt,
    },
    201
  );
}
