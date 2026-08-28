import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";
import { pickGoogleDriveAccount, uploadToDrive } from "@/lib/storage-api/drive-backend";

async function resolveBucket(ownerId: string, bucketId?: string | null) {
  if (!bucketId) return null;
  return (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId, isActive: true } });
}

async function findOrCreateLogicalFolder(bucketId: string, parentId: string | null, name: string) {
  const parent = parentId ? await (prisma as any).storageFolder.findFirst({ where: { id: parentId, bucketId } }) : null;
  const path = parent ? `${parent.path}/${name}` : name;
  const existing = await (prisma as any).storageFolder.findFirst({ where: { bucketId, path } });
  if (existing) return existing;
  return (prisma as any).storageFolder.create({ data: { bucketId, parentId, name, path } });
}

async function resolveUploadTarget(bucketId: string, form: FormData, fallbackName: string) {
  const folderId = String(form.get("folder_id") || "") || null;
  if (folderId) {
    const folder = await (prisma as any).storageFolder.findFirst({ where: { id: folderId, bucketId } });
    if (!folder) throw new Error("FOLDER_NOT_FOUND");
    const name = String(form.get("name") || fallbackName).trim();
    return { folderId, folderPath: folder.path, name, logicalPath: `${folder.path}/${name}` };
  }

  const rawPath = String(form.get("path") || "").trim().replace(/^\/+|\/+$/g, "");
  if (!rawPath) {
    const name = String(form.get("name") || fallbackName).trim();
    return { folderId: null, folderPath: null, name, logicalPath: name };
  }

  const parts = rawPath.split("/").filter(Boolean);
  const name = String(form.get("name") || parts.pop() || fallbackName).trim();
  let parentId: string | null = null;
  let folderPath: string | null = null;
  for (const folderName of parts) {
    const folder = await findOrCreateLogicalFolder(bucketId, parentId, folderName);
    parentId = folder.id;
    folderPath = folder.path;
  }
  return { folderId: parentId, folderPath, name, logicalPath: folderPath ? `${folderPath}/${name}` : name };
}

export async function GET(request: NextRequest) {
  const auth = await getSessionOrApiKey(request, "file:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const bucketId = auth.bucketId || request.nextUrl.searchParams.get("bucket_id");
  const bucket = await resolveBucket(auth.ownerId, bucketId);
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  const folderId = request.nextUrl.searchParams.get("folder_id");
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const objects = await (prisma as any).storageObject.findMany({
    where: { bucketId: bucket.id, status: { not: "DELETED" }, ...(folderId ? { folderId } : { folderId: null }), ...(q ? { name: { contains: q } } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return successResponse({ objects: objects.map((item: any) => ({ ...item, fileSize: Number(item.fileSize) })) });
}

export async function POST(request: NextRequest) {
  const auth = await getSessionOrApiKey(request, "video:create");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("VALIDATION_ERROR", "File is required.", 400);
  const bucketId = auth.bucketId || String(form.get("bucket_id") || "");
  const bucket = await resolveBucket(auth.ownerId, bucketId);
  if (!bucket) return errorResponse("BUCKET_NOT_FOUND", "Bucket not found.", 404);
  let target: Awaited<ReturnType<typeof resolveUploadTarget>>;
  try {
    target = await resolveUploadTarget(bucket.id, form, file.name);
  } catch {
    return errorResponse("FOLDER_NOT_FOUND", "Folder not found.", 404);
  }
  const size = BigInt(file.size);
  if (bucket.maxBytes && bucket.usedBytes + size > bucket.maxBytes) return errorResponse("INSUFFICIENT_STORAGE", "Bucket quota exceeded.", 409);
  try {
    const account = await pickGoogleDriveAccount(auth.ownerId);
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadToDrive(
      auth.ownerId,
      account.id,
      bucket.name,
      target.folderPath,
      target.name,
      file.type || "application/octet-stream",
      buffer,
    );
    const object = await (prisma as any).$transaction(async (tx: any) => {
      const created = await tx.storageObject.create({
        data: { bucketId: bucket.id, folderId: target.folderId, name: target.name, originalName: file.name, logicalPath: target.logicalPath, mimeType: file.type || null, fileSize: size, providerAccountId: account.id, providerFileId: uploaded.id, status: "AVAILABLE" },
      });
      await tx.bucket.update({ where: { id: bucket.id }, data: { usedBytes: { increment: size } } });
      return created;
    });
    return successResponse({ ...object, fileSize: Number(object.fileSize) }, 201);
  } catch {
    return errorResponse("UPLOAD_FAILED", "Upload object failed.", 502);
  }
}

