import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const domains = await (prisma as any).customDomain.findMany({ where: { ownerId: user.id }, include: { bucket: true }, orderBy: { createdAt: "desc" } });
  return successResponse({ domains });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const domain = String(body.domain || "").trim().toLowerCase();
  if (!/^(?=.{1,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return errorResponse("VALIDATION_ERROR", "Invalid domain.", 400);
  if (body.bucket_id) {
    const bucket = await (prisma as any).bucket.findFirst({ where: { id: body.bucket_id, ownerId: user.id } });
    if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  }
  try {
    const created = await (prisma as any).customDomain.create({ data: { ownerId: user.id, bucketId: body.bucket_id || null, domain } });
    return successResponse(created, 201);
  } catch { return errorResponse("DOMAIN_EXISTS", "Domain already exists.", 409); }
}
