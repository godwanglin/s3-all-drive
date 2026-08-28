import { NextRequest } from "next/server";
import { createHmac, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/security/encryption";
import { hasPermission } from "@/lib/storage-api/auth";

export function generateS3Secret() {
  return `secret_s3_${randomBytes(32).toString("hex")}`;
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string) {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = createHmac("sha256", kDate).update(regionName, "utf8").digest();
  const kService = createHmac("sha256", kRegion).update(serviceName, "utf8").digest();
  return createHmac("sha256", kService).update("aws4_request", "utf8").digest();
}

export async function verifyS3Request(request: NextRequest, permission?: string) {
  const auth = request.headers.get("authorization") || "";
  const match = /AWS4-HMAC-SHA256\s+Credential=([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]+)/i.exec(auth);
  if (!match) return null;

  const [_, accessKey, dateStamp, region, service, signedHeaders, signature] = match;
  const apiKey = await (prisma as any).apiKey.findFirst({ where: { keyPrefix: accessKey, status: "ACTIVE" }, include: { bucket: true } });
  if (!apiKey || !apiKey.bucket.isActive || !apiKey.secretEncrypted) return null;
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) return null;

  const secret = decryptToken(apiKey.secretEncrypted);
  const amzDate = request.headers.get("x-amz-date") || "";
  const canonicalHeadersList = signedHeaders.toLowerCase().split(";");
  const canonicalHeaders = canonicalHeadersList
    .map((header) => {
      const val = (request.headers.get(header) || "").trim().replace(/\s+/g, " ");
      return `${header}:${val}\n`;
    })
    .join("");

  const url = new URL(request.url);
  const canonicalUri = encodeURI(url.pathname);
  const canonicalQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const payloadHash = request.headers.get("x-amz-content-sha256") || "UNSIGNED-PAYLOAD";
  const canonicalRequest = [request.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders.toLowerCase(), payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, `${dateStamp}/${region}/${service}/aws4_request`, createHash("sha256").update(canonicalRequest, "utf8").digest("hex")].join("\n");

  const signingKey = getSignatureKey(secret, dateStamp, region, service);
  const expectedSignature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  if (signature.toLowerCase() !== expectedSignature.toLowerCase()) return null;
  if (permission && !hasPermission(Array.isArray(apiKey.permissions) ? apiKey.permissions : [], permission)) return null;
  await (prisma as any).apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  return { apiKey, ownerId: apiKey.ownerId, bucketId: apiKey.bucketId, bucket: apiKey.bucket };
}

