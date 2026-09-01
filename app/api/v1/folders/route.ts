import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";

async function pruneVirtualFolders(bucketId: string) {
  const folders = await (prisma as any).storageFolder.findMany({
    where: { bucketId, isVirtual: true },
    select: { id: true },
    orderBy: { path: "desc" },
  });
  for (const folder of folders) {
    const [objects, children] = await Promise.all([
      (prisma as any).storageObject.count({ where: { folderId: folder.id, status: { not: "DELETED" } } }),
      (prisma as any).storageFolder.count({ where: { parentId: folder.id } }),
    ]);
    if (!objects && !children) await (prisma as any).storageFolder.delete({ where: { id: folder.id } }).catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  const auth = await getSessionOrApiKey(request, "folder:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const bucketId = auth.bucketId || request.nextUrl.searchParams.get("bucket_id");
  if (!bucketId) return errorResponse("BUCKET_NOT_FOUND", "Bucket is required.", 404);
  const bucket = await (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId: auth.ownerId, isActive: true } });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  await pruneVirtualFolders(bucketId);
  const parentId = request.nextUrl.searchParams.get("parent_id");
  const folders = await (prisma as any).storageFolder.findMany({ where: { bucketId, parentId: parentId || null }, orderBy: { name: "asc" } });
  return successResponse({ folders });
}

export async function POST(request: NextRequest) {
  const auth = await getSessionOrApiKey(request, "folder:create");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const body = await request.json().catch(() => ({}));
  const bucketId = auth.bucketId || body.bucket_id;
  const bucket = await (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId: auth.ownerId, isActive: true } });
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  const name = String(body.name || "").trim();
  if (!name) return errorResponse("VALIDATION_ERROR", "Folder name is required.", 400);
  const parentId = body.parent_id || null;
  const parent = parentId ? await (prisma as any).storageFolder.findFirst({ where: { id: parentId, bucketId } }) : null;
  if (parentId && !parent) return errorResponse("PARENT_NOT_FOUND", "Parent folder not found.", 404);
  const path = parent ? `${parent.path}/${name}` : name;
  try {
    const folder = await (prisma as any).storageFolder.create({ data: { bucketId, parentId, name, path } });
    return successResponse(folder, 201);
  } catch {
    return errorResponse("FOLDER_EXISTS", "Folder already exists in this directory.", 409);
  }
}
