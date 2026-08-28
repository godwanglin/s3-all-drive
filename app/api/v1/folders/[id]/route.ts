import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";
import { deleteDriveFolderPath, deleteFromDrive } from "@/lib/storage-api/drive-backend";

async function getBucket(request: NextRequest, ownerId: string, apiBucketId?: string) {
  const bucketId = apiBucketId || request.nextUrl.searchParams.get("bucket_id");
  if (!bucketId) return null;
  return (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId, isActive: true } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "folder:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const bucket = await getBucket(request, auth.ownerId, auth.bucketId);
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  const { id } = await context.params;
  const folder = await (prisma as any).storageFolder.findFirst({ where: { id, bucketId: bucket.id } });
  if (!folder) return errorResponse("NOT_FOUND", "Folder not found.", 404);
  return successResponse(folder);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "folder:update");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const body = await request.json().catch(() => ({}));
  const bucketId = auth.bucketId || body.bucket_id;
  const bucket = await (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId: auth.ownerId, isActive: true } });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  const { id } = await context.params;
  const folder = await (prisma as any).storageFolder.findFirst({ where: { id, bucketId } });
  if (!folder) return errorResponse("NOT_FOUND", "Folder not found.", 404);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : folder.name;
  const parentId = body.parent_id !== undefined ? (body.parent_id || null) : folder.parentId;
  const parent = parentId ? await (prisma as any).storageFolder.findFirst({ where: { id: parentId, bucketId } }) : null;
  if (parentId && !parent) return errorResponse("PARENT_NOT_FOUND", "Parent folder not found.", 404);
  const path = parent ? `${parent.path}/${name}` : name;
  await (prisma as any).storageFolder.update({ where: { id }, data: { name, parentId, path } });
  return successResponse({ updated: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "folder:delete");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const bucket = await getBucket(request, auth.ownerId, auth.bucketId);
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  const { id } = await context.params;
  const target = await (prisma as any).storageFolder.findFirst({ where: { id, bucketId: bucket.id } });
  if (!target) return errorResponse("NOT_FOUND", "Folder not found.", 404);

  const folders = await (prisma as any).storageFolder.findMany({
    where: {
      bucketId: bucket.id,
      OR: [{ id }, { path: { startsWith: `${target.path}/` } }],
    },
    select: { id: true },
  });
  const folderIds = folders.map((folder: { id: string }) => folder.id);
  const objects = await (prisma as any).storageObject.findMany({
    where: { bucketId: bucket.id, folderId: { in: folderIds }, status: { not: "DELETED" } },
    select: { id: true, fileSize: true, providerAccountId: true, providerFileId: true },
  });

  await Promise.all(
    objects.map((object: { providerAccountId: string | null; providerFileId: string | null }) =>
      object.providerAccountId && object.providerFileId
        ? deleteFromDrive(auth.ownerId, object.providerAccountId, object.providerFileId)
        : Promise.resolve(),
    ),
  );

  const accounts = await prisma.googleDriveAccount.findMany({
    where: { userId: auth.ownerId },
    select: { id: true },
  });
  await Promise.all(
    accounts.map((account: { id: string }) =>
      deleteDriveFolderPath(auth.ownerId, account.id, bucket.name, target.path),
    ),
  );

  const deletedBytes = objects.reduce((sum: bigint, object: { fileSize: bigint }) => sum + object.fileSize, BigInt(0));
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.storageObject.updateMany({
      where: { id: { in: objects.map((object: { id: string }) => object.id) } },
      data: { status: "DELETED" },
    });
    await tx.storageFolder.deleteMany({ where: { id: { in: folderIds } } });
    if (deletedBytes > BigInt(0)) {
      await tx.bucket.update({ where: { id: bucket.id }, data: { usedBytes: { decrement: deletedBytes } } });
    }
  });
  return successResponse({ deleted: true, folders: folderIds.length, objects: objects.length, deleted_bytes: Number(deletedBytes) });
}

