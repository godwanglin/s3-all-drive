import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { fetchObjectFromProvider } from "@/lib/storage-api/provider-backend";

const metaCache = new Map<string, { data: any; expiresAt: number }>();

function getStreamingCacheControl(name: string) {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".m3u8")) return "public, max-age=5, s-maxage=30, stale-while-revalidate=300";
  if (lowerName.endsWith(".ts") || lowerName.endsWith(".m4s") || lowerName.endsWith(".mp4")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await context.params;
  const publicPath = slug?.map(decodeURIComponent).join("/") || "";
  const bucketSlug = slug?.[0];
  if (!bucketSlug) return errorResponse("NOT_FOUND", "Public path is required.", 404);

  const publicBucket = await (prisma as any).bucket.findFirst({
    where: { slug: bucketSlug, isPublic: true, isActive: true },
    select: { id: true, ownerId: true },
  });
  if (publicBucket && slug.length > 1) {
    const key = publicPath.slice(bucketSlug.length + 1);
    const publicObject = await (prisma as any).storageObject.findFirst({
      where: { bucketId: publicBucket.id, logicalPath: key, status: "AVAILABLE" },
    });
    if (publicObject) return streamPublicObject(request, publicObject, publicBucket.ownerId);
  }

  const token = bucketSlug;

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
  if (!object.storageProviderId && (!object.providerAccountId || !object.providerFileId)) {
    return errorResponse("STORAGE_ERROR", "Object provider data is missing.", 502);
  }

  return streamPublicObject(request, object, object.bucket.ownerId);
}

async function streamPublicObject(request: NextRequest, object: any, ownerId: string) {
  try {
    const upstream = await fetchObjectFromProvider(object, ownerId, request.headers.get("range"));
    if (!upstream.ok && upstream.status !== 206) return errorResponse("STORAGE_ERROR", "Unable to read public object.", 502);
    const headers = new Headers({
      "Content-Type": object.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(object.name)}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": getStreamingCacheControl(object.name),
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
