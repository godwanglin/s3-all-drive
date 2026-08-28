import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyS3Request } from "@/lib/storage-api/s3-auth";
import { pickGoogleDriveAccount, uploadToDrive, deleteFromDrive } from "@/lib/storage-api/drive-backend";
import { fetchDriveMediaStream } from "@/lib/google-drive/direct-stream";

function xml(body: string, status = 200) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
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
          data: { bucketId: auth.bucketId, parentId: folderId, name: folderName, path: folderPath },
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
  const account = await pickGoogleDriveAccount(auth.ownerId);
  const uploaded = await uploadToDrive(
    auth.ownerId,
    account.id,
    auth.bucket.name,
    folderPath || null,
    name,
    request.headers.get("content-type") || "application/octet-stream",
    buffer,
  );

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
          providerAccountId: account.id,
          providerFileId: uploaded.id,
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
          providerAccountId: account.id,
          providerFileId: uploaded.id,
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
  return new NextResponse("", {
    status: 200,
    headers: {
      "Content-Length": "0",
      ETag: `"${etag}"`,
      "x-amz-version-id": object.id,
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await verifyS3Request(request, "file:read");
  if (!auth) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
  const { bucket, key } = parsePath((await context.params).path);
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

  const upstream = await fetchDriveMediaStream(object.providerAccountId, auth.ownerId, object.providerFileId, request.headers.get("range"));
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
  if (object) {
    await deleteFromDrive(auth.ownerId, object.providerAccountId, object.providerFileId);
    await (prisma as any).storageObject.update({ where: { id: object.id }, data: { status: "DELETED" } });
    await (prisma as any).bucket.update({ where: { id: auth.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
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
    await deleteFromDrive(auth.ownerId, object.providerAccountId, object.providerFileId);
    await (prisma as any).storageObject.update({ where: { id: object.id }, data: { status: "DELETED" } });
    await (prisma as any).bucket.update({ where: { id: auth.bucketId }, data: { usedBytes: { decrement: object.fileSize } } });
  }
  return xml(`<DeleteResult>${keys.map((objectKey) => `<Deleted><Key>${escapeXml(objectKey)}</Key></Deleted>`).join("")}</DeleteResult>`);
}

