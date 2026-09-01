import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/security/encryption";
import { syncStorageProviderUsage } from "@/lib/storage-api/provider-backend";

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

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const provider = await (prisma as any).storageProvider.findFirst({ where: { id, ownerId: user.id } });
  if (!provider) return errorResponse("NOT_FOUND", "Storage provider not found.", 404);
  return successResponse(providerResponse(provider));
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.endpoint === "string" && body.endpoint.trim()) data.endpoint = body.endpoint.trim();
  if (typeof body.region === "string" && body.region.trim()) data.region = body.region.trim();
  if (typeof body.bucket_name === "string" && body.bucket_name.trim()) data.bucketName = body.bucket_name.trim();
  if (body.max_bytes !== undefined) data.maxBytes = body.max_bytes === null ? null : BigInt(body.max_bytes);
  if (typeof body.access_key_id === "string" && body.access_key_id.trim()) data.accessKeyId = body.access_key_id.trim();
  if (typeof body.secret_access_key === "string" && body.secret_access_key.trim()) data.secretAccessKeyEnc = encryptToken(body.secret_access_key.trim());
  if (typeof body.force_path_style === "boolean") data.forcePathStyle = body.force_path_style;
  if (typeof body.is_active === "boolean") data.isActive = body.is_active;
  if (typeof body.is_default === "boolean") data.isDefault = body.is_default;
  if (data.isDefault) await (prisma as any).storageProvider.updateMany({ where: { ownerId: user.id }, data: { isDefault: false } });
  const result = await (prisma as any).storageProvider.updateMany({ where: { id, ownerId: user.id }, data });
  if (!result.count) return errorResponse("NOT_FOUND", "Storage provider not found.", 404);
  const provider = await (prisma as any).storageProvider.findFirst({ where: { id, ownerId: user.id } });
  return successResponse(providerResponse(provider));
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const inUse = await (prisma as any).storageObject.count({ where: { storageProviderId: id, bucket: { ownerId: user.id }, status: { not: "DELETED" } } });
  if (inUse) return errorResponse("PROVIDER_IN_USE", "Storage provider still has active objects.", 409);
  const result = await (prisma as any).storageProvider.deleteMany({ where: { id, ownerId: user.id } });
  if (!result.count) return errorResponse("NOT_FOUND", "Storage provider not found.", 404);
  return successResponse({ deleted: true });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (body.action !== "sync") return errorResponse("VALIDATION_ERROR", "Unsupported action.", 400);
  const result = await syncStorageProviderUsage(id, user.id);
  return successResponse({ provider: providerResponse(result.provider), object_count: result.objectCount });
}
