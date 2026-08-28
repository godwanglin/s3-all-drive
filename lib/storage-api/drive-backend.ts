import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { getCachedDriveClient } from "@/lib/google-drive/token-cache";

export async function pickGoogleDriveAccount(userId: string) {
  const accounts = await prisma.googleDriveAccount.findMany({ where: { userId } });
  if (!accounts.length) throw new Error("NO_DRIVE_ACCOUNT");
  return accounts[0];
}

async function findOrCreateFolder(
  drive: Awaited<ReturnType<typeof getCachedDriveClient>>,
  name: string,
  parentId?: string,
) {
  const escapedName = name.replace(/'/g, "\\'");
  const parentQuery = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
  const existing = await drive.files.list({
    q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentQuery}`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("DRIVE_FOLDER_CREATE_FAILED");
  return created.data.id;
}

export async function deleteDriveFolderPath(
  userId: string,
  accountId: string,
  bucketName: string,
  folderPath: string,
) {
  const drive = await getCachedDriveClient(accountId, userId);
  const objectStorageId = await findOrCreateFolder(drive, "ObjectStorage");
  const bucketId = await findOrCreateFolder(drive, bucketName, objectStorageId);
  const parts = folderPath.split("/").filter(Boolean);
  let parentId = bucketId;
  const folderIds: string[] = [];

  for (const part of parts) {
    const folderId = await findExistingFolder(drive, part, parentId);
    if (!folderId) return;
    folderIds.push(folderId);
    parentId = folderId;
  }

  const targetId = folderIds.at(-1);
  if (targetId) await drive.files.delete({ fileId: targetId });
}

async function findExistingFolder(
  drive: Awaited<ReturnType<typeof getCachedDriveClient>>,
  name: string,
  parentId: string,
) {
  const escapedName = name.replace(/'/g, "\\'");
  const result = await drive.files.list({
    q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`,
    fields: "files(id)",
    pageSize: 1,
  });
  return result.data.files?.[0]?.id || null;
}

export async function uploadToDrive(
  userId: string,
  accountId: string,
  bucketName: string,
  logicalFolderPath: string | null,
  filename: string,
  mimeType: string,
  buffer: Buffer,
) {
  const drive = await getCachedDriveClient(accountId, userId);
  const objectStorageFolderId = await findOrCreateFolder(drive, "ObjectStorage");
  const bucketFolderId = await findOrCreateFolder(drive, bucketName, objectStorageFolderId);
  let parentId = bucketFolderId;
  if (logicalFolderPath) {
    for (const folderName of logicalFolderPath.split("/").filter(Boolean)) {
      parentId = await findOrCreateFolder(drive, folderName, parentId);
    }
  }
  const stream = Readable.from(buffer);
  const response = await drive.files.create({
    requestBody: { name: filename, mimeType, parents: [parentId] },
    media: { mimeType, body: stream },
    fields: "id,name,size,mimeType",
  });
  return response.data;
}

export async function deleteFromDrive(userId: string, accountId: string, fileId: string) {
  try {
    const drive = await getCachedDriveClient(accountId, userId);
    await drive.files.delete({ fileId });
  } catch {
    // Provider file may already be deleted.
  }
}
