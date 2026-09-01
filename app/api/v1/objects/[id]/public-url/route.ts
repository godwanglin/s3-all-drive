import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const object = await (prisma as any).storageObject.findFirst({ where: { id, ...(auth.bucketId ? { bucketId: auth.bucketId } : {}), bucket: { ownerId: auth.ownerId } }, include: { bucket: { select: { slug: true, isPublic: true } } } });
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  if (object.bucket.isPublic) {
    const url = `${request.nextUrl.origin}/s3/${encodeURIComponent(object.bucket.slug)}/${object.logicalPath.split("/").map(encodeURIComponent).join("/")}`;
    return successResponse({ url, direct: true, lifetime: true });
  }
  const token = randomBytes(24).toString("hex");
  await (prisma as any).storageObject.update({ where: { id }, data: { isPublic: true, publicUrlToken: token, publicUrlExpiresAt: null } });
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const url = `${protocol}://${host}/public/${token}/${encodeURIComponent(object.name)}`;
  return successResponse({ url, token, expires_at: null, lifetime: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:update");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const object = await (prisma as any).storageObject.findFirst({ where: { id, ...(auth.bucketId ? { bucketId: auth.bucketId } : {}), bucket: { ownerId: auth.ownerId } } });
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  await (prisma as any).storageObject.update({ where: { id }, data: { isPublic: false, publicUrlToken: null, publicUrlExpiresAt: null } });
  return successResponse({ revoked: true });
}
