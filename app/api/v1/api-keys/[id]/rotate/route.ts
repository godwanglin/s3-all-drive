import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/storage-api/auth";

export async function POST(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const current = await (prisma as any).apiKey.findFirst({ where: { id, ownerId: user.id } });
  if (!current) return errorResponse("NOT_FOUND", "API key not found.", 404);
  const generated = generateApiKey();
  const rotated = await (prisma as any).apiKey.update({
    where: { id },
    data: { keyPrefix: generated.keyPrefix, keyHash: generated.keyHash, status: "ACTIVE", lastUsedAt: null },
  });
  return successResponse({
    id: rotated.id, name: rotated.name, bucket_id: rotated.bucketId,
    permissions: rotated.permissions, key_prefix: rotated.keyPrefix,
    raw_key: generated.rawKey, expires_at: rotated.expiresAt, created_at: rotated.createdAt,
  });
}
