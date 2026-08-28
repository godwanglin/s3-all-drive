import { prisma } from "@/lib/db";

export async function resolveBucket(ownerId: string, apiBucketId: string | undefined, requestedBucketId: string | null) {
  const bucketId = apiBucketId || requestedBucketId;
  if (!bucketId) return null;
  return (prisma as any).bucket.findFirst({ where: { id: bucketId, ownerId, isActive: true } });
}

export function joinPath(parentPath: string | null | undefined, name: string) {
  const cleanName = name.trim().replace(/^\/+|\/+$/g, "");
  return parentPath ? `${parentPath}/${cleanName}` : cleanName;
}
