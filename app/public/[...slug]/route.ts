import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { fetchDriveMediaStream } from "@/lib/google-drive/direct-stream";

const metaCache = new Map<string, { data: any; expiresAt: number }>();

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await context.params;
  const token = slug?.[0];
  if (!token) return errorResponse("NOT_FOUND", "Token is required.", 404);

  let cached = metaCache.get(token);
  let object = cached && cached.expiresAt > Date.now() ? cached.data : null;
  if (!object) {
    object = await (prisma as any).storageObject.findFirst({
      where: { publicUrlToken: token, isPublic: true, status: "AVAILABLE" },
      include: { bucket: { select: { ownerId: true } } },
    });
    if (object) metaCache.set(token, { data: object, expiresAt: Date.now() + 60_000 });
  }

  if (!object) return errorResponse("NOT_FOUND", "Public object not found.", 404);
  if (object.publicUrlExpiresAt && new Date(object.publicUrlExpiresAt).getTime() < Date.now()) {
    metaCache.delete(token);
    return errorResponse("URL_EXPIRED", "Public URL expired.", 410);
  }
  if (!object.providerAccountId || !object.providerFileId) {
    return errorResponse("STORAGE_ERROR", "Object provider data is missing.", 502);
  }

  try {
    const range = request.headers.get("range");
    const upstream = await fetchDriveMediaStream(object.providerAccountId, object.bucket.ownerId, object.providerFileId, range);
    if (!upstream.ok && upstream.status !== 206) return errorResponse("STORAGE_ERROR", "Unable to read public object.", 502);

    const headers = new Headers({
      "Content-Type": object.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(object.name)}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    });
    for (const name of ["content-range", "content-length", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return errorResponse("STORAGE_ERROR", "Unable to read public object.", 502);
  }
}
