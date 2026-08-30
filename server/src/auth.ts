import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { serverConfig } from "./config.js";

const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function generatePairingCode(length = 10): string {
  const bytes = randomBytes(length);
  let result = "";
  for (const byte of bytes) result += pairingAlphabet[byte % pairingAlphabet.length];
  return result;
}

export function hashPairingCode(code: string): Buffer {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  const hash = createHash("sha256");
  if (serverConfig.pairingPepper) hash.update(serverConfig.pairingPepper, "utf8");
  return hash.update(normalized, "utf8").digest();
}

export function hashesEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
