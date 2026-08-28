import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getGoogleDriveClient } from "@/lib/google-drive/token-manager";
import { invalidateDriveClient } from "@/lib/google-drive/token-cache";
import { NextRequest } from "next/server";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const accounts = await prisma.googleDriveAccount.findMany({
    where: { userId: user.id },
    select: { id: true, email: true, name: true, picture: true },
    orderBy: { createdAt: "asc" },
  });
  const enriched = await Promise.all(accounts.map(async (account) => {
    try {
      const drive = await getGoogleDriveClient(account.id, user.id);
      const about = await drive.about.get({ fields: "storageQuota" });
      const quota = about.data.storageQuota;
      const usageBytes = Number(quota?.usage || quota?.usageInDrive || 0);
      const limitBytes = Number(quota?.limit || 15 * 1024 * 1024 * 1024);
      return {
        ...account,
        usageBytes,
        limitBytes,
        usagePercent: limitBytes ? Math.min(100, Math.round((usageBytes / limitBytes) * 100)) : 0,
      };
    } catch {
      return { ...account, usageBytes: 0, limitBytes: 15 * 1024 * 1024 * 1024, usagePercent: 0 };
    }
  }));
  return successResponse({ accounts: enriched });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return errorResponse("INVALID_ACCOUNT", "Google Drive account is required.", 400);

  await prisma.googleDriveAccount.deleteMany({
    where: { id: accountId, userId: user.id },
  });
  invalidateDriveClient(accountId);

  return successResponse({ deleted: true });
}
