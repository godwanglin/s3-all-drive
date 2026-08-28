import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { getGoogleDriveClient } from "@/lib/google-drive/token-manager";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  try {
    const drive = await getGoogleDriveClient(accountId, user.id);
    const result = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: "files(id, name)",
      orderBy: "name asc",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return successResponse({ folders: result.data.files ?? [] });
  } catch (error) {
    console.error("DRIVE_FOLDERS_FAILED:", error);
    return errorResponse("DRIVE_FOLDERS_FAILED", "Unable to access Google Drive folders.", 502);
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  try {
    const body = await request.json() as {
      accountId?: string;
      name?: string;
      parentFolderId?: string;
    };
    const accountId = body.accountId?.trim();
    const name = body.name?.trim();
    if (!accountId || !name) {
      return errorResponse("VALIDATION_ERROR", "Account and folder name are required.", 400);
    }

    const drive = await getGoogleDriveClient(accountId, user.id);
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(body.parentFolderId && body.parentFolderId !== "root" ? { parents: [body.parentFolderId] } : {}),
      },
      fields: "id,name,mimeType,modifiedTime,createdTime",
      supportsAllDrives: true,
    });
    return successResponse({ folder: created.data });
  } catch (error) {
    console.error("DRIVE_CREATE_FOLDER_FAILED:", error);
    return errorResponse("DRIVE_CREATE_FOLDER_FAILED", "Unable to create folder in Google Drive.", 502);
  }
}
