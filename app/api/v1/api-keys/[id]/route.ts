import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const key = await (prisma as any).apiKey.findFirst({
    where: { id, ownerId: user.id },
    include: { bucket: { select: { id: true, name: true, slug: true } } },
  });
  if (!key) return errorResponse("NOT_FOUND", "API key not found.", 404);
  return successResponse({
    id: key.id, name: key.name, bucket_id: key.bucketId, bucket: key.bucket,
    key_prefix: key.keyPrefix, permissions: key.permissions, status: key.status,
    expires_at: key.expiresAt, last_used_at: key.lastUsedAt, created_at: key.createdAt,
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (Array.isArray(body.permissions) && body.permissions.length) data.permissions = body.permissions;
  if (["ACTIVE", "REVOKED", "EXPIRED"].includes(body.status)) data.status = body.status;
  if (body.expires_at !== undefined) data.expiresAt = body.expires_at ? new Date(body.expires_at) : null;
  const result = await (prisma as any).apiKey.updateMany({ where: { id, ownerId: user.id }, data });
  if (!result.count) return errorResponse("NOT_FOUND", "API key not found.", 404);
  return successResponse({ updated: true });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const result = await (prisma as any).apiKey.updateMany({ where: { id, ownerId: user.id }, data: { status: "REVOKED" } });
  if (!result.count) return errorResponse("NOT_FOUND", "API key not found.", 404);
  return successResponse({ revoked: true });
}
