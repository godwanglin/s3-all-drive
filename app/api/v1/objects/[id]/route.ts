import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";
import { deleteObjectFromProvider } from "@/lib/storage-api/provider-backend";

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
  const videoPrefixMatch = object.logicalPath.match(/^videos\/([A-Za-z0-9_-]+)\/.+/);
  if (videoPrefixMatch) {
    const prefix = `videos/${videoPrefixMatch[1]}/`;
    const objects = await (prisma as any).storageObject.findMany({
      where: { bucketId: object.bucketId, logicalPath: { startsWith: prefix }, status: { not: "DELETED" } },
    });
    await Promise.all(objects.map((item: any) => deleteObjectFromProvider(item, auth.ownerId)));
    const deletedBytes = objects.reduce((sum: bigint, item: any) => sum + item.fileSize, BigInt(0));
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.storageObject.updateMany({
        where: { id: { in: objects.map((item: any) => item.id) } },
        data: { status: "DELETED" },
      });
      await tx.storageFolder.deleteMany({
        where: { bucketId: object.bucketId, OR: [{ path: prefix.slice(0, -1) }, { path: { startsWith: prefix } }] },
      });
      if (deletedBytes > BigInt(0)) {
        await tx.bucket.update({ where: { id: object.bucketId }, data: { usedBytes: { decrement: deletedBytes } } });
      }
    });
    return successResponse({ deleted: true, recursive: true, prefix, objects: objects.length });
  }
  await deleteObjectFromProvider(object, auth.ownerId);
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.storageObject.update({ where: { id }, data: { status: "DELETED" } });
    await tx.bucket.update({ where: { id: object.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
  });
  return successResponse({ deleted: true });
}
