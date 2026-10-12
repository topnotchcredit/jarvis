import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for integration credentials stored in integration_secrets.
 * Format: v<keyVersion>.<iv>.<authTag>.<ciphertext>, each part base64url.
 * The organization id is bound in as additional authenticated data, so a ciphertext
 * copied into another tenant's row fails to decrypt.
 */
function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes, base64 encoded");
  return key;
}

export function encryptSecret(plaintext: string, base64Key: string, organizationId: string, keyVersion = 1): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(base64Key), iv);
  cipher.setAAD(Buffer.from(organizationId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [`v${keyVersion}`, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, base64Key: string, organizationId: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) throw new Error("Malformed secret envelope");
  const [, iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv("aes-256-gcm", loadKey(base64Key), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(organizationId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Do not surface OpenSSL details; they can vary with the input.
    throw new Error("Secret could not be decrypted");
  }
}
