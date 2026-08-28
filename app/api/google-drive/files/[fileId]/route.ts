import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { getGoogleDriveClient } from "@/lib/google-drive/token-manager";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return errorResponse("INVALID_NAME", "File name is required.", 400);

  try {
    const { fileId } = await context.params;
    const drive = await getGoogleDriveClient(accountId, user.id);
    const result = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: "id, name, mimeType, size, modifiedTime",
      supportsAllDrives: true,
    });
    return successResponse({ file: result.data });
  } catch (error) {
    console.error("DRIVE_RENAME_FAILED:", error);
    return errorResponse("DRIVE_RENAME_FAILED", "Unable to rename item.", 502);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  try {
    const { fileId } = await context.params;
    const drive = await getGoogleDriveClient(accountId, user.id);
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return successResponse({ deleted: true });
  } catch (error) {
    console.error("DRIVE_DELETE_FAILED:", error);
    return errorResponse("DRIVE_DELETE_FAILED", "Unable to delete item.", 502);
  }
}
