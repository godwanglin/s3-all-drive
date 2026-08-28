import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const rawKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not defined");
  if (rawKey.length === 64) return Buffer.from(rawKey, "hex");
  const buffer = Buffer.from(rawKey, "utf-8");
  if (buffer.length === 32) return buffer;
  throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes or 64 hex chars");
}

export function encryptToken(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptToken(payload: string): string {
  const [ivHex, authTagHex, encryptedHex] = payload.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid encrypted payload format");
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}
