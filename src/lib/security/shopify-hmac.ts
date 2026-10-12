import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Shopify webhook signature: base64(HMAC-SHA256(app secret, raw request body))
 * compared in constant time against the X-Shopify-Hmac-Sha256 header.
 * `rawBody` must be the exact bytes received, before any JSON parsing.
 * Matches shopify.dev "Verify webhook deliveries" (checked 2026-10-12). After a client-secret
 * rotation Shopify may sign with the old secret for up to an hour.
 */
export function verifyShopifyWebhook(rawBody: Buffer | string, hmacHeader: string | null | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
