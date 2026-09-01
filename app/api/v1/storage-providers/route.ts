import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/security/encryption";
import { syncAllStorageProviderUsage, syncStorageProviderUsage } from "@/lib/storage-api/provider-backend";

function providerResponse(provider: any) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    endpoint: provider.endpoint,
    region: provider.region,
    bucket_name: provider.bucketName,
    max_bytes: provider.maxBytes === null ? null : Number(provider.maxBytes),
    used_bytes: Number(provider.usedBytes || 0),
    access_key_id: provider.accessKeyId,
    force_path_style: provider.forcePathStyle,
    is_default: provider.isDefault,
    is_active: provider.isActive,
    created_at: provider.createdAt,
    updated_at: provider.updatedAt,
  };
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const providers = await (prisma as any).storageProvider.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } });
  return successResponse({ providers: providers.map(providerResponse) });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const secret = String(body.secret_access_key || "").trim();
  const maxBytes = body.max_bytes ? BigInt(body.max_bytes) : null;
  if (maxBytes !== null && maxBytes <= BigInt(0)) return errorResponse("VALIDATION_ERROR", "Storage limit must be greater than zero.", 400);
  const data = {
    ownerId: user.id,
    type: "S3_COMPATIBLE",
    name,
    endpoint: String(body.endpoint || "").trim(),
    region: String(body.region || "auto").trim(),
    bucketName: String(body.bucket_name || "").trim(),
    maxBytes,
    accessKeyId: String(body.access_key_id || "").trim(),
    secretAccessKeyEnc: secret ? encryptToken(secret) : null,
    forcePathStyle: body.force_path_style !== false,
    isDefault: Boolean(body.is_default),
  };
  if (!data.name || !data.endpoint || !data.bucketName || !data.accessKeyId || !data.secretAccessKeyEnc) {
    return errorResponse("VALIDATION_ERROR", "S3 provider config is incomplete.", 400);
  }
  if (data.isDefault) await (prisma as any).storageProvider.updateMany({ where: { ownerId: user.id }, data: { isDefault: false } });
  const provider = await (prisma as any).storageProvider.create({ data });
  const syncResult = await syncStorageProviderUsage(provider.id, user.id).catch(() => null);
  return successResponse(providerResponse(syncResult?.provider || provider), 201);
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  if (body.action !== "sync_all") return errorResponse("VALIDATION_ERROR", "Unsupported action.", 400);
  const synced = await syncAllStorageProviderUsage(user.id);
  return successResponse({ synced });
}
