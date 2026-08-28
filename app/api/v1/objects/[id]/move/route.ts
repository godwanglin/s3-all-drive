import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:update");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const targetFolderId = body.folder_id || null;
  const object = await (prisma as any).storageObject.findFirst({ where: { id, ...(auth.bucketId ? { bucketId: auth.bucketId } : {}), bucket: { ownerId: auth.ownerId } } });
  if (!object) return errorResponse("NOT_FOUND", "Object not found.", 404);
  let folderPath = "";
  if (targetFolderId) {
    const targetFolder = await (prisma as any).storageFolder.findFirst({ where: { id: targetFolderId, bucketId: object.bucketId } });
    if (!targetFolder) return errorResponse("FOLDER_NOT_FOUND", "Target folder must belong to the same bucket.", 404);
    folderPath = targetFolder.path;
  }
  const logicalPath = folderPath ? `${folderPath}/${object.name}` : object.name;
  await (prisma as any).storageObject.update({ where: { id }, data: { folderId: targetFolderId, logicalPath } });
  return successResponse({ moved: true, logical_path: logicalPath });
}
