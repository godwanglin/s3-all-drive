import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { getCachedDriveClient } from "@/lib/google-drive/token-cache";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  try {
    const { fileId } = await context.params;
    const drive = await getCachedDriveClient(accountId, user.id);
    const range = request.headers.get("range");
    const previewMode = request.nextUrl.searchParams.get("preview") === "1";
    const [meta, file] = await Promise.all([
      drive.files.get({ fileId, fields: "name,mimeType,size" }),
      drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream", headers: range ? { Range: range } : undefined }
      ),
    ]);
    const mimeType = meta.data.mimeType || "application/octet-stream";
    const fileSize = Number(meta.data.size || 0);
    const isVideo = mimeType.startsWith("video/");
    let start = 0;
    let end = fileSize > 0 ? fileSize - 1 : 0;

    if (range && fileSize > 0) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
      if (!match) {
        return new NextResponse("Invalid range.", { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
      }
      start = match[1] ? Number(match[1]) : Math.max(fileSize - Number(match[2] || 0), 0);
      end = match[2] ? Number(match[2]) : end;
      end = Math.min(end, fileSize - 1);
      if (start > end || start >= fileSize) {
        return new NextResponse("Range not satisfiable.", { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
      }
    }

    const stream = file.data as NodeJS.ReadableStream;
    const headers = new Headers({
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": isVideo ? "inline" : `attachment; filename="${encodeURIComponent(meta.data.name || "download")}"`,
    });

    if (previewMode || mimeType.startsWith("image/")) {
      headers.set("Content-Disposition", "inline");
      headers.set("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
    }

    if (range && fileSize > 0) {
      headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      headers.set("Content-Length", String(end - start + 1));
    } else if (fileSize > 0) {
      headers.set("Content-Length", String(fileSize));
    }

    return new NextResponse(stream as unknown as BodyInit, {
      status: range && fileSize > 0 ? 206 : 200,
      headers,
    });
  } catch {
    return errorResponse("DRIVE_DOWNLOAD_FAILED", "Unable to download file.", 502);
  }
}
