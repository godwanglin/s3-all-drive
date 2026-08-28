import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeRecord, slugify } from "@/lib/storage-api/format";

function bucketResponse(bucket: Record<string, unknown>) {
  return serializeRecord({
    id: bucket.id,
    name: bucket.name,
    slug: bucket.slug,
    used_bytes: bucket.usedBytes,
    max_bytes: bucket.maxBytes,
    is_active: bucket.isActive,
    created_at: bucket.createdAt,
    updated_at: bucket.updatedAt,
  });
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const buckets = await (prisma as any).bucket.findMany({
    where: {
      ownerId: user.id,
      ...(query ? { name: { contains: query } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return successResponse({ buckets: buckets.map(bucketResponse) });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const slug = slugify(String(body.slug || name));
  const maxBytes = body.max_bytes ? BigInt(body.max_bytes) : null;
  if (!name || !slug) return errorResponse("VALIDATION_ERROR", "Bucket name and slug are required.", 400);
  if (maxBytes !== null && maxBytes <= BigInt(0)) return errorResponse("VALIDATION_ERROR", "Max bytes must be greater than zero.", 400);
  try {
    const bucket = await (prisma as any).bucket.create({
      data: { ownerId: user.id, name, slug, maxBytes },
    });
    return successResponse(bucketResponse(bucket), 201);
  } catch {
    return errorResponse("BUCKET_EXISTS", "Bucket slug already exists.", 409);
  }
}
