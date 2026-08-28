import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getSessionOrApiKey } from "@/lib/storage-api/auth";
import { fetchDriveMediaStream } from "@/lib/google-drive/direct-stream";

const objectCache = new Map<string, { data: any; expiresAt: number }>();

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getSessionOrApiKey(request, "file:read");
  if ("error" in auth) return errorResponse(auth.error, "Unauthorized", auth.status);
  const { id } = await context.params;
  const cacheKey = `${auth.ownerId}:${auth.bucketId || "session"}:${id}`;
  let cached = objectCache.get(cacheKey);
  let object = cached && cached.expiresAt > Date.now() ? cached.data : null;
  if (!object) {
    object = await (prisma as any).storageObject.findFirst({
      where: { id, ...(auth.bucketId ? { bucketId: auth.bucketId } : {}), bucket: { ownerId: auth.ownerId } },
    });
    if (object) objectCache.set(cacheKey, { data: object, expiresAt: Date.now() + 60_000 });
  }
  if (!object || object.status !== "AVAILABLE") return errorResponse("NOT_FOUND", "Object not found.", 404);
  if (!object.providerAccountId || !object.providerFileId) return errorResponse("STORAGE_ERROR", "Object provider data is missing.", 502);

  try {
    const range = request.headers.get("range");
    const upstream = await fetchDriveMediaStream(object.providerAccountId, auth.ownerId, object.providerFileId, range);
    if (!upstream.ok && upstream.status !== 206) return errorResponse("STORAGE_ERROR", "Unable to read object.", 502);

    const headers = new Headers({
      "Content-Type": object.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    for (const name of ["content-range", "content-length", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return errorResponse("STORAGE_ERROR", "Unable to read object.", 502);
  }
}
