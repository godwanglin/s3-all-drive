import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

function parseCorsOrigins(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value
    .split(/[\n,]/)
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin, index, origins) => origins.indexOf(origin) === index);
}

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const bucket = await (prisma as any).bucket.findFirst({
    where: { id, ownerId: user.id },
    include: { _count: { select: { objects: true, folders: true, apiKeys: true } } },
  });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  return successResponse({ ...bucket, usedBytes: Number(bucket.usedBytes), maxBytes: bucket.maxBytes === null ? null : Number(bucket.maxBytes) });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.slug === "string" && body.slug.trim()) data.slug = body.slug.trim().toLowerCase();
  if (body.max_bytes !== undefined) data.maxBytes = body.max_bytes === null ? null : BigInt(body.max_bytes);
  if (typeof body.is_active === "boolean") data.isActive = body.is_active;
  if (typeof body.is_public === "boolean") data.isPublic = body.is_public;
  const corsOrigins = parseCorsOrigins(body.cors_origins);
  if (corsOrigins) data.corsOrigins = corsOrigins;
  const result = await (prisma as any).bucket.updateMany({ where: { id, ownerId: user.id }, data });
  if (!result.count) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  return successResponse({ updated: true });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const bucket = await (prisma as any).bucket.findFirst({
    where: { id, ownerId: user.id },
    include: { _count: { select: { objects: true, folders: true } } },
  });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  if (bucket._count.objects || bucket._count.folders) return errorResponse("BUCKET_NOT_EMPTY", "Bucket must be empty before deletion.", 409);
  await (prisma as any).bucket.delete({ where: { id } });
  return successResponse({ deleted: true });
}
