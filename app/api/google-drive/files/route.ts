import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { getGoogleDriveClient } from "@/lib/google-drive/token-manager";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  const folderId = request.nextUrl.searchParams.get("folderId") || "root";
  const view = request.nextUrl.searchParams.get("view") || "all";

  try {
    const drive = await getGoogleDriveClient(accountId, user.id);
    const queryParts = view === "trash"
      ? ["trashed = true"]
      : view === "starred"
        ? ["starred = true", "trashed = false"]
        : view === "shared"
          ? ["sharedWithMe = true", "trashed = false"]
          : view === "recent"
            ? ["trashed = false"]
          : [`'${folderId}' in parents`, "trashed = false"];
    const result = await drive.files.list({
      fields: "files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink)",
      q: queryParts.join(" and "),
      orderBy: "modifiedTime desc",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return successResponse({ files: result.data.files ?? [] });
  } catch (error) {
    console.error("DRIVE_LIST_FAILED:", error);
    return errorResponse("DRIVE_LIST_FAILED", "Unable to access Google Drive files.", 502);
  }
}
