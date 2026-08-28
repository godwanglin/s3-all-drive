import { Readable } from "stream";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { getGoogleDriveClient } from "@/lib/google-drive/token-manager";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const formData = await request.formData();
  const accountId = formData.get("accountId");
  const folderId = formData.get("folderId");
  const file = formData.get("file");

  if (typeof accountId !== "string" || !(file instanceof File)) {
    return errorResponse("INVALID_UPLOAD", "Account and file are required.", 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse("FILE_TOO_LARGE", "File exceeds the upload limit.", 413);
  }

  try {
    const drive = await getGoogleDriveClient(accountId, user.id);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const parents =
      typeof folderId === "string" && folderId.trim() && folderId !== "root"
        ? [folderId.trim()]
        : undefined;
    const result = await drive.files.create({
      requestBody: {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        parents,
      },
      media: {
        mimeType: file.type || "application/octet-stream",
        body: Readable.from(fileBuffer),
      },
      fields: "id,name,mimeType,size,modifiedTime",
    });
    return successResponse({ file: result.data }, 201);
  } catch {
    return errorResponse("DRIVE_UPLOAD_FAILED", "Unable to upload file.", 502);
  }
}
