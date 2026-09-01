import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { fetchDriveMediaStream } from "@/lib/google-drive/direct-stream";
import { decryptToken } from "@/lib/security/encryption";
import { deleteFromDrive, pickGoogleDriveAccount, uploadToDrive } from "./drive-backend";

type UploadObjectInput = {
  ownerId: string;
  bucketName: string;
  folderPath: string | null;
  logicalPath: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

function normalizeStorageKey(logicalPath: string) {
  return logicalPath.split("/").filter(Boolean).join("/");
}

async function pickStorageProviders(ownerId: string, providerId?: string | null) {
  if (providerId) {
    const provider = await (prisma as any).storageProvider.findFirst({ where: { id: providerId, ownerId, isActive: true } });
    return provider ? [provider] : [];
  }
  return (prisma as any).storageProvider.findMany({ where: { ownerId, isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
}

function createS3Client(provider: any) {
  if (!provider.endpoint || !provider.region || !provider.bucketName || !provider.accessKeyId || !provider.secretAccessKeyEnc) {
    throw new Error("S3_PROVIDER_INCOMPLETE");
  }
  return new S3Client({
    endpoint: provider.endpoint,
    region: provider.region,
    forcePathStyle: provider.forcePathStyle,
    credentials: {
      accessKeyId: provider.accessKeyId,
      secretAccessKey: decryptToken(provider.secretAccessKeyEnc),
    },
  });
}

export async function uploadObjectToProvider(input: UploadObjectInput, providerId?: string | null) {
  const providers = await pickStorageProviders(input.ownerId, providerId);
  if (!providers.length) {
    const account = await pickGoogleDriveAccount(input.ownerId);
    const uploaded = await uploadToDrive(input.ownerId, account.id, input.bucketName, input.folderPath, input.filename, input.mimeType, input.buffer);
    return { providerAccountId: account.id, providerFileId: uploaded.id, storageProviderId: null, storageKey: null };
  }

  const size = BigInt(input.buffer.length);
  const storageKey = normalizeStorageKey(input.logicalPath);
  for (const provider of providers) {
    const currentProvider = await (prisma as any).storageProvider.findFirst({
      where: { id: provider.id, ownerId: input.ownerId, isActive: true },
      select: { id: true, usedBytes: true, maxBytes: true },
    });
    if (!currentProvider) continue;
    if (currentProvider.maxBytes !== null && currentProvider.usedBytes + size > currentProvider.maxBytes) continue;

    const reserved = await (prisma as any).storageProvider.updateMany({
      where: {
        id: currentProvider.id,
        ownerId: input.ownerId,
        isActive: true,
        usedBytes: currentProvider.usedBytes,
        OR: [{ maxBytes: null }, { maxBytes: { gte: currentProvider.usedBytes + size } }],
      },
      data: { usedBytes: { increment: size } },
    });
    if (!reserved.count) continue;
    try {
      await createS3Client(provider).send(new PutObjectCommand({ Bucket: provider.bucketName, Key: storageKey, Body: input.buffer, ContentType: input.mimeType }));
      return { providerAccountId: null, providerFileId: null, storageProviderId: provider.id, storageKey };
    } catch (error) {
      await (prisma as any).storageProvider.update({ where: { id: provider.id }, data: { usedBytes: { decrement: size } } });
    }
  }

  const account = await pickGoogleDriveAccount(input.ownerId);
  const uploaded = await uploadToDrive(input.ownerId, account.id, input.bucketName, input.folderPath, input.filename, input.mimeType, input.buffer);
  return { providerAccountId: account.id, providerFileId: uploaded.id, storageProviderId: null, storageKey: null };
}

export async function syncStorageProviderUsage(providerId: string, ownerId: string) {
  const provider = await (prisma as any).storageProvider.findFirst({ where: { id: providerId, ownerId, isActive: true } });
  if (!provider) throw new Error("STORAGE_PROVIDER_NOT_FOUND");
  const client = createS3Client(provider);
  let continuationToken: string | undefined;
  let usedBytes = BigInt(0);
  let objectCount = 0;

  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: provider.bucketName, ContinuationToken: continuationToken }));
    for (const item of response.Contents || []) {
      usedBytes += BigInt(item.Size || 0);
      objectCount += 1;
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  const updated = await (prisma as any).storageProvider.update({ where: { id: provider.id }, data: { usedBytes } });
  return { provider: updated, usedBytes, objectCount };
}

export async function syncAllStorageProviderUsage(ownerId: string) {
  const providers = await (prisma as any).storageProvider.findMany({ where: { ownerId, isActive: true } });
  const results = [];
  for (const provider of providers) {
    try {
      const result = await syncStorageProviderUsage(provider.id, ownerId);
      results.push({ id: provider.id, ok: true, used_bytes: Number(result.usedBytes), object_count: result.objectCount });
    } catch (error) {
      results.push({ id: provider.id, ok: false, error: error instanceof Error ? error.message : "SYNC_FAILED" });
    }
  }
  return results;
}

export async function fetchObjectFromProvider(object: any, ownerId: string, range?: string | null) {
  if (object.storageProviderId && object.storageKey) {
    const provider = await (prisma as any).storageProvider.findFirst({ where: { id: object.storageProviderId, ownerId, isActive: true } });
    if (!provider) throw new Error("STORAGE_PROVIDER_NOT_FOUND");
    const response = await createS3Client(provider).send(new GetObjectCommand({ Bucket: provider.bucketName, Key: object.storageKey, Range: range || undefined }));
    return new Response(response.Body as BodyInit, {
      status: range && response.ContentRange ? 206 : 200,
      headers: {
        ...(response.ContentType ? { "Content-Type": response.ContentType } : {}),
        ...(response.ContentLength ? { "Content-Length": String(response.ContentLength) } : {}),
        ...(response.ContentRange ? { "Content-Range": response.ContentRange } : {}),
        ...(response.ETag ? { ETag: response.ETag } : {}),
        ...(response.LastModified ? { "Last-Modified": response.LastModified.toUTCString() } : {}),
      },
    });
  }
  return fetchDriveMediaStream(object.providerAccountId, ownerId, object.providerFileId, range);
}

export async function deleteObjectFromProvider(object: any, ownerId: string) {
  if (object.storageProviderId && object.storageKey) {
    const provider = await (prisma as any).storageProvider.findFirst({ where: { id: object.storageProviderId, ownerId, isActive: true } });
    if (!provider) return;
    await createS3Client(provider).send(new DeleteObjectCommand({ Bucket: provider.bucketName, Key: object.storageKey })).catch(() => undefined);
    if (object.fileSize) await (prisma as any).storageProvider.update({ where: { id: provider.id }, data: { usedBytes: { decrement: object.fileSize } } });
    return;
  }
  if (object.providerAccountId && object.providerFileId) await deleteFromDrive(ownerId, object.providerAccountId, object.providerFileId);
}

export async function deleteProviderPrefix(provider: any, prefix: string) {
  const normalizedPrefix = normalizeStorageKey(prefix);
  if (!normalizedPrefix.endsWith("/")) throw new Error("INVALID_STORAGE_PREFIX");
  const client = createS3Client(provider);
  let continuationToken: string | undefined;
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: provider.bucketName, Prefix: normalizedPrefix, ContinuationToken: continuationToken }));
    const keys = (response.Contents || [])
      .map((item) => item.Key || "")
      .filter((key) => key.startsWith(normalizedPrefix));
    for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: provider.bucketName, Key: key }));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
}
