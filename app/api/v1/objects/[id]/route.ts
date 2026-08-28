import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";
import { deleteFromDrive } from "@/lib/storage-api/drive-backend";

async function findObject(id: string, ownerId: string, bucketId?: string) {
  return (prisma as any).storageObject.findFirst({ where: { id, ...(bucketId ? { bucketId } : {}), bucket: { ownerId } } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const object = await findObject(id, auth.ownerId, auth.bucketId);
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  return successResponse({ ...object, fileSize: Number(object.fileSize) });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:update");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const object = await findObject(id, auth.ownerId, auth.bucketId || body.bucket_id);
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.folder_id !== undefined) data.folderId = body.folder_id || null;
  await (prisma as any).storageObject.update({ where: { id }, data });
  return successResponse({ updated: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:delete");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const object = await findObject(id, auth.ownerId, auth.bucketId || request.nextUrl.searchParams.get("bucket_id") || undefined);
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  if (object.providerAccountId && object.providerFileId) await deleteFromDrive(auth.ownerId, object.providerAccountId, object.providerFileId);
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.storageObject.update({ where: { id }, data: { status: "DELETED" } });
    await tx.bucket.update({ where: { id: object.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
  });
  return successResponse({ deleted: true });
}
