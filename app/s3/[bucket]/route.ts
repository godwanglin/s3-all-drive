import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyS3Request } from "@/lib/storage-api/s3-auth";
import { deleteFromDrive } from "@/lib/storage-api/drive-backend";

function xml(body: string, status = 200) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
}

export async function GET(request: NextRequest, context: { params: Promise<{ bucket: string }> }) {
  const auth = await verifyS3Request(request, "file:read");
  if (!auth) return xml("<Error><Code>AccessDenied</Code></Error>", 403);
  const bucket = decodeURIComponent((await context.params).bucket);
  if (bucket !== auth.bucket.slug) return xml("<Error><Code>NoSuchBucket</Code></Error>", 404);
  const objects = await (prisma as any).storageObject.findMany({ where: { bucketId: auth.bucketId, status: "AVAILABLE" }, orderBy: { logicalPath: "asc" } });
  const contents = objects.map((item: any) => `<Contents><Key>${escapeXml(item.logicalPath)}</Key><LastModified>${new Date(item.updatedAt).toISOString()}</LastModified><ETag>"${createHash("md5").update(item.logicalPath).digest("hex")}"</ETag><Size>${item.fileSize}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
  return xml(
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucket)}</Name><Prefix></Prefix><KeyCount>${objects.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ bucket: string }> }) {
  const auth = await verifyS3Request(request, "file:delete");
  if (!auth) return xml("<Error><Code>AccessDenied</Code></Error>", 403);
  const bucket = decodeURIComponent((await context.params).bucket);
  if (bucket !== auth.bucket.slug || !request.nextUrl.searchParams.has("delete")) return xml("<Error><Code>InvalidRequest</Code></Error>", 400);
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
