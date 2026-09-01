import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyS3Request } from "@/lib/storage-api/s3-auth";
import { deleteObjectFromProvider, deleteProviderPrefix, fetchObjectFromProvider, uploadObjectToProvider } from "@/lib/storage-api/provider-backend";

const publicObjectCache = new Map<string, { bucket: any; object: any; expiresAt: number }>();
const PUBLIC_OBJECT_CACHE_TTL = 30_000;
const PUBLIC_OBJECT_CACHE_LIMIT = 256;

function xml(body: string, status = 200, headers?: Headers) {
  const responseHeaders = headers || new Headers();
  responseHeaders.set("Content-Type", "application/xml");
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: responseHeaders,
  });
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
}

function parsePath(path: string[]) {
  return {
    bucket: decodeURIComponent(path[0] || ""),
    key: path.slice(1).map(decodeURIComponent).join("/"),
  };
}

function getStreamingCacheControl(key: string) {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith(".m3u8")) return "public, max-age=5, s-maxage=30, stale-while-revalidate=300";
  if (lowerKey.endsWith(".ts") || lowerKey.endsWith(".m4s") || lowerKey.endsWith(".mp4")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}

function applyCorsHeaders(headers: Headers, request: NextRequest, bucket: { corsOrigins?: unknown }) {
  const requestOrigin = request.headers.get("origin");
  const corsOrigins = Array.isArray(bucket.corsOrigins) ? bucket.corsOrigins.filter((origin): origin is string => typeof origin === "string") : [];
  if (!requestOrigin || !corsOrigins.includes(requestOrigin)) return;
  headers.set("Access-Control-Allow-Origin", requestOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, x-amz-date, x-amz-content-sha256");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Cache-Control, ETag, Last-Modified");
  headers.set("Vary", "Origin");
}

async function removeEmptyFolders(bucketId: string) {
  const folders = await (prisma as any).storageFolder.findMany({
    where: { bucketId },
    select: { id: true, path: true },
    orderBy: { path: "desc" },
  });
  for (const folder of folders) {
    const objectCount = await (prisma as any).storageObject.count({
      where: { bucketId, folderId: folder.id, status: { not: "DELETED" } },
    });
    if (!objectCount) await (prisma as any).storageFolder.delete({ where: { id: folder.id } }).catch(() => undefined);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await verifyS3Request(request, "file:create");
  if (!auth) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
  const { bucket, key } = parsePath((await context.params).path);
  if (bucket !== auth.bucket.slug || !key) {
    return xml("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>", 404);
  }

  const segments = key.split("/").filter(Boolean);
  const name = segments.pop()!;
  let folderId: string | null = null;
  let folderPath = "";

  for (const folderName of segments) {
    folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
    let folder = await (prisma as any).storageFolder.findFirst({
      where: { bucketId: auth.bucketId, path: folderPath },
    });
    if (!folder) {
      try {
        folder = await (prisma as any).storageFolder.create({
          data: { bucketId: auth.bucketId, parentId: folderId, name: folderName, path: folderPath, isVirtual: true },
        });
      } catch {
        folder = await (prisma as any).storageFolder.findFirst({
          where: { bucketId: auth.bucketId, path: folderPath },
        });
      }
    }
    folderId = folder?.id || null;
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  const uploaded = await uploadObjectToProvider({
    ownerId: auth.ownerId,
    bucketName: auth.bucket.name,
    folderPath: folderPath || null,
    logicalPath: key,
    filename: name,
    mimeType: request.headers.get("content-type") || "application/octet-stream",
    buffer,
  });

  const existingObject = await (prisma as any).storageObject.findFirst({
    where: { bucketId: auth.bucketId, logicalPath: key },
  });

  const object = existingObject
    ? await (prisma as any).storageObject.update({
        where: { id: existingObject.id },
        data: {
          folderId,
          name,
          originalName: name,
          fileSize: BigInt(buffer.length),
          mimeType: request.headers.get("content-type") || "application/octet-stream",
          ...uploaded,
          status: "AVAILABLE",
        },
      })
    : await (prisma as any).storageObject.create({
        data: {
          bucketId: auth.bucketId,
          folderId,
          name,
          originalName: name,
          logicalPath: key,
          mimeType: request.headers.get("content-type") || "application/octet-stream",
          fileSize: BigInt(buffer.length),
          ...uploaded,
          status: "AVAILABLE",
        },
      });

  const diff = existingObject ? BigInt(buffer.length) - existingObject.fileSize : BigInt(buffer.length);
  if (diff !== BigInt(0)) {
    await (prisma as any).bucket.update({
      where: { id: auth.bucketId },
      data: { usedBytes: { increment: diff } },
    });
  }

  const etag = createHash("md5").update(buffer).digest("hex");
  return xml(
    `<PutObjectResult><Key>${escapeXml(key)}</Key><Bucket>${escapeXml(bucket)}</Bucket><ETag>"${etag}"</ETag></PutObjectResult>`,
    200,
  );
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { bucket: requestedBucket, key: requestedKey } = parsePath((await context.params).path);
  const publicBucket = await (prisma as any).bucket.findFirst({
    where: { slug: requestedBucket, isPublic: true, isActive: true },
  });
  if (publicBucket && requestedKey) {
    const corsHeaders = new Headers();
    applyCorsHeaders(corsHeaders, request, publicBucket);
    corsHeaders.set("Vary", "Origin");
    const cacheKey = `${publicBucket.id}:${requestedKey}`;
    const cached = publicObjectCache.get(cacheKey);
    const object = cached && cached.expiresAt > Date.now()
      ? cached.object
      : await (prisma as any).storageObject.findFirst({
          where: { bucketId: publicBucket.id, logicalPath: requestedKey, status: "AVAILABLE" },
        });
    if (!object) return xml("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>", 404, corsHeaders);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (publicObjectCache.size >= PUBLIC_OBJECT_CACHE_LIMIT) {
        publicObjectCache.delete(publicObjectCache.keys().next().value!);
      }
      publicObjectCache.set(cacheKey, { bucket: publicBucket, object, expiresAt: Date.now() + PUBLIC_OBJECT_CACHE_TTL });
    }
    let upstream: Response;
    try {
      upstream = await fetchObjectFromProvider(object, publicBucket.ownerId, request.headers.get("range"));
    } catch {
      return xml("<Error><Code>StorageError</Code><Message>Unable to read object</Message></Error>", 502, corsHeaders);
    }
    if (!upstream.ok && upstream.status !== 206) return xml("<Error><Code>StorageError</Code><Message>Unable to read object</Message></Error>", 502, corsHeaders);
    const headers = new Headers({
      "Content-Type": object.mimeType || "application/octet-stream",
      "Content-Length": upstream.headers.get("content-length") || String(object.fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": getStreamingCacheControl(requestedKey),
      "Content-Disposition": `inline; filename="${object.name}"`,
      ETag: `"${createHash("md5").update(`${object.id}:${object.updatedAt}`).digest("hex")}"`,
      "Last-Modified": new Date(object.updatedAt).toUTCString(),
    });
    if (upstream.headers.get("content-range")) headers.set("Content-Range", upstream.headers.get("content-range")!);
    applyCorsHeaders(headers, request, publicBucket);
    headers.set("Vary", "Origin");
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }

  const auth = await verifyS3Request(request, "file:read");
  if (!auth) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
  const { bucket, key } = { bucket: requestedBucket, key: requestedKey };
  if (bucket !== auth.bucket.slug) {
    return xml("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>", 404);
  }

  if (!key) {
    const objects = await (prisma as any).storageObject.findMany({
      where: { bucketId: auth.bucketId, status: "AVAILABLE" },
      orderBy: { logicalPath: "asc" },
    });
    const contents = objects
      .map(
        (item: any) =>
          `<Contents><Key>${escapeXml(item.logicalPath)}</Key><LastModified>${new Date(item.updatedAt).toISOString()}</LastModified><ETag>"${createHash("md5").update(item.logicalPath).digest("hex")}"</ETag><Size>${item.fileSize}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
      )
      .join("");
    return xml(
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucket)}</Name><Prefix></Prefix><KeyCount>${objects.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
      200,
    );
  }

  const object = await (prisma as any).storageObject.findFirst({
    where: { bucketId: auth.bucketId, logicalPath: key, status: "AVAILABLE" },
  });
  if (!object) return xml("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>", 404);

  const upstream = await fetchObjectFromProvider(object, auth.ownerId, request.headers.get("range"));
  const headers = new Headers({
    "Content-Type": object.mimeType || "application/octet-stream",
    "Content-Length": upstream.headers.get("content-length") || String(object.fileSize),
    "Accept-Ranges": "bytes",
    "Cache-Control": getStreamingCacheControl(key),
    "Content-Disposition": `inline; filename="${object.name}"`,
  });
  if (upstream.headers.get("content-range")) headers.set("Content-Range", upstream.headers.get("content-range")!);
  applyCorsHeaders(headers, request, auth.bucket);
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { bucket: requestedBucket, key: requestedKey } = parsePath((await context.params).path);
  const publicBucket = await (prisma as any).bucket.findFirst({
    where: { slug: requestedBucket, isPublic: true, isActive: true },
  });
  if (publicBucket && requestedKey) {
    const object = await (prisma as any).storageObject.findFirst({
      where: { bucketId: publicBucket.id, logicalPath: requestedKey, status: "AVAILABLE" },
    });
    const headers = new Headers();
    applyCorsHeaders(headers, request, publicBucket);
    headers.set("Vary", "Origin");
    if (!object) return new NextResponse(null, { status: 404, headers });
    headers.set("Content-Type", object.mimeType || "application/octet-stream");
    headers.set("Content-Length", String(object.fileSize));
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", getStreamingCacheControl(requestedKey));
    return new NextResponse(null, { status: 200, headers });
  }

  const auth = await verifyS3Request(request, "file:read");
  if (!auth) return new NextResponse(null, { status: 403 });
  const { bucket, key } = parsePath((await context.params).path);
  if (bucket !== auth.bucket.slug) return new NextResponse(null, { status: 404 });
  const object = await (prisma as any).storageObject.findFirst({
    where: { bucketId: auth.bucketId, logicalPath: key, status: "AVAILABLE" },
  });
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers({
    "Content-Type": object.mimeType || "application/octet-stream",
    "Content-Length": String(object.fileSize),
    "Accept-Ranges": "bytes",
    "Cache-Control": getStreamingCacheControl(key),
    ETag: `"${createHash("md5").update(object.logicalPath).digest("hex")}"`,
    "Last-Modified": new Date(object.updatedAt).toUTCString(),
  });
  applyCorsHeaders(headers, request, auth.bucket);
  return new NextResponse(null, { status: 200, headers });
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { bucket: requestedBucket } = parsePath((await context.params).path);
  const publicBucket = await (prisma as any).bucket.findFirst({
    where: { slug: requestedBucket, isPublic: true, isActive: true },
  });
  if (publicBucket) {
    const headers = new Headers();
    applyCorsHeaders(headers, request, publicBucket);
    return new NextResponse(null, { status: headers.has("Access-Control-Allow-Origin") ? 204 : 403, headers });
  }
  const auth = await verifyS3Request(request, "file:read");
  if (!auth) return new NextResponse(null, { status: 403 });
  const { bucket } = parsePath((await context.params).path);
  if (bucket !== auth.bucket.slug) return new NextResponse(null, { status: 404 });
  const headers = new Headers();
  applyCorsHeaders(headers, request, auth.bucket);
  return new NextResponse(null, { status: headers.has("Access-Control-Allow-Origin") ? 204 : 403, headers });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await verifyS3Request(request, "file:delete");
  if (!auth) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
  const { bucket, key } = parsePath((await context.params).path);
  if (bucket !== auth.bucket.slug || !key) {
    return xml("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>", 404);
  }
  const object = await (prisma as any).storageObject.findFirst({
    where: { bucketId: auth.bucketId, logicalPath: key },
  });
  const videoPrefixMatch = key.match(/^videos\/([A-Za-z0-9_-]+)\/.+/);
  if (videoPrefixMatch) {
    const prefix = `videos/${videoPrefixMatch[1]}/`;
    const objects = await (prisma as any).storageObject.findMany({
      where: { bucketId: auth.bucketId, logicalPath: { startsWith: prefix }, status: { not: "DELETED" } },
    });
    const providers = new Map<string, any>();
    for (const item of objects) {
      if (item.storageProviderId && item.storageKey?.startsWith(prefix) && !providers.has(item.storageProviderId)) {
        const provider = await (prisma as any).storageProvider.findFirst({
          where: { id: item.storageProviderId, ownerId: auth.ownerId, isActive: true },
        });
        if (provider) providers.set(provider.id, provider);
      }
    }
    for (const provider of providers.values()) await deleteProviderPrefix(provider, prefix);
    await Promise.all(objects.map((item: any) => item.providerAccountId && item.providerFileId ? deleteObjectFromProvider(item, auth.ownerId) : Promise.resolve()));
    const deletedBytes = objects.reduce((sum: bigint, item: any) => sum + item.fileSize, BigInt(0));
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.storageObject.updateMany({ where: { id: { in: objects.map((item: any) => item.id) } }, data: { status: "DELETED" } });
      await tx.storageFolder.deleteMany({ where: { bucketId: auth.bucketId, OR: [{ path: prefix.slice(0, -1) }, { path: { startsWith: prefix } }] } });
      if (deletedBytes > BigInt(0)) await tx.bucket.update({ where: { id: auth.bucketId }, data: { usedBytes: { decrement: deletedBytes } } });
    });
    await removeEmptyFolders(auth.bucketId);
    return new NextResponse(null, { status: 204 });
  }
  if (object) {
    await deleteObjectFromProvider(object, auth.ownerId);
    await (prisma as any).storageObject.update({ where: { id: object.id }, data: { status: "DELETED" } });
    await (prisma as any).bucket.update({ where: { id: auth.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
    await removeEmptyFolders(auth.bucketId);
  }
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await verifyS3Request(request, "file:delete");
  if (!auth) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
  const { bucket, key } = parsePath((await context.params).path);
  if (bucket !== auth.bucket.slug || key) return xml("<Error><Code>InvalidRequest</Code></Error>", 400);
  const body = await request.text();
  const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  for (const objectKey of keys) {
    const object = await (prisma as any).storageObject.findFirst({ where: { bucketId: auth.bucketId, logicalPath: objectKey } });
    if (!object) continue;
    await deleteObjectFromProvider(object, auth.ownerId);
    await (prisma as any).storageObject.update({ where: { id: object.id }, data: { status: "DELETED" } });
    await (prisma as any).bucket.update({ where: { id: auth.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
  }
  return xml(`<DeleteResult>${keys.map((objectKey) => `<Deleted><Key>${escapeXml(objectKey)}</Key></Deleted>`).join("")}</DeleteResult>`);
}

