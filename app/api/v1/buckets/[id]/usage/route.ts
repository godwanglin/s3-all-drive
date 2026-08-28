import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const bucket = await (prisma as any).bucket.findFirst({ where: { id, ownerId: user.id } });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  return successResponse({
    bucket_id: id,
    used_bytes: Number(bucket.usedBytes),
    max_bytes: bucket.maxBytes === null ? null : Number(bucket.maxBytes),
    usage_percent: bucket.maxBytes ? Math.round(Number(bucket.usedBytes) / Number(bucket.maxBytes) * 100) : null,
  });
}
