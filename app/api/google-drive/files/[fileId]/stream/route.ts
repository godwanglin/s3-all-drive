import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { fetchDriveMediaStream } from "@/lib/google-drive/direct-stream";

export async function GET(request: NextRequest, context: { params: Promise<{ fileId: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);
  try {
    const { fileId } = await context.params;
    const range = request.headers.get("range");
    const upstream = await fetchDriveMediaStream(accountId, user.id, fileId, range);
    if (!upstream.ok && upstream.status !== 206) return errorResponse("DRIVE_STREAM_FAILED", "Unable to stream video.", 502);
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Vary": "Range",
    });
    for (const name of ["content-range", "content-length", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return errorResponse("DRIVE_STREAM_FAILED", "Unable to stream video.", 502);
  }
}
