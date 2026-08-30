import { describe, expect, it } from "vitest";
import { generateDeviceToken, generatePairingCode, hashDeviceToken, hashPairingCode, hashesEqual } from "../../src/auth.js";

describe("sync credentials", () => {
  it("generates URL-safe device tokens and stable hashes", () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashesEqual(hashDeviceToken(token), hashDeviceToken(token))).toBe(true);
    expect(hashesEqual(hashDeviceToken(token), hashDeviceToken(`${token}x`))).toBe(false);
  });

  it("generates human-readable pairing codes and normalizes formatting", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(hashPairingCode(code)).toEqual(hashPairingCode(`${code.slice(0, 5)}-${code.slice(5).toLowerCase()}`));
  });
});
