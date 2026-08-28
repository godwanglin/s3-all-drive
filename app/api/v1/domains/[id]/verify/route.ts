import { NextRequest } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return errorResponse("UNAUTHORIZED", "Authentication required.", 401);
  const { id } = await context.params;
  const result = await (prisma as any).customDomain.updateMany({ where: { id, ownerId: user.id }, data: { isVerified: true } });
  if (!result.count) return errorResponse("NOT_FOUND", "Domain not found.", 404);
  return successResponse({ verified: true });
}
