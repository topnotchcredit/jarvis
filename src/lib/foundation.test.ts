import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { guardAgentOutput } from "./ai/output-guard";
import { findPublicSecretNames, readPublicEnv, readServerEnv } from "./env";
import { redact } from "./logging/logger";
import { add, CurrencyMismatchError, formatMoney, money, multiply, ratioBps, sum } from "./money";
import { decryptSecret, encryptSecret } from "./security/crypto";
import { verifyShopifyWebhook } from "./security/shopify-hmac";

describe("money", () => {
  it("adds without floating point drift", () => {
    expect(add(money(10, "USD"), money(20, "USD")).amountMinor).toBe(30); // 0.1 + 0.2
    expect(sum([money(1999, "USD"), money(1, "USD")], "USD").amountMinor).toBe(2000);
    expect(multiply(money(1999, "USD"), 3).amountMinor).toBe(5997);
  });
  it("rejects fractional minor units and bad currency codes", () => {
    expect(() => money(10.5, "USD")).toThrow(RangeError);
    expect(() => money(10, "usd")).toThrow(RangeError);
  });
  it("refuses to combine currencies", () => {
    expect(() => add(money(1, "USD"), money(1, "EUR"))).toThrow(CurrencyMismatchError);
  });
  it("computes ratios in basis points and returns null on a zero denominator", () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(5, 0)).toBeNull();
  });
  it("formats using each currency's minor unit", () => {
    expect(formatMoney(money(123456, "USD"))).toBe("$1,234.56");
    expect(formatMoney(money(1234, "JPY"))).toBe("¥1,234");
  });
});

describe("Shopify webhook signature (acceptance criterion 7, verification part)", () => {
  // Vector computed independently: printf '%s' "$body" | openssl dgst -sha256 -hmac test_shared_secret -binary | base64
  const body = '{"id":1,"topic":"orders/create"}';
  const signature = "kApTDik9m9FQJXSLJX2v6CbaAM+3z1u+1x+THaBBtm4=";
  it("accepts the correct signature", () => {
    expect(verifyShopifyWebhook(body, signature, "test_shared_secret")).toBe(true);
    expect(verifyShopifyWebhook(Buffer.from(body), signature, "test_shared_secret")).toBe(true);
  });
  it("rejects a tampered body, a wrong secret, and a missing, empty or malformed header", () => {
    expect(verifyShopifyWebhook(body + " ", signature, "test_shared_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, signature, "other_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, null, "test_shared_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, "", "test_shared_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, "not-base64!!", "test_shared_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, signature.slice(0, -4), "test_shared_secret")).toBe(false);
    expect(verifyShopifyWebhook(body, signature, "")).toBe(false);
  });
});

describe("credential encryption", () => {
  const key = randomBytes(32).toString("base64");
  it("round-trips and produces a different ciphertext each time", () => {
    const a = encryptSecret("shpat_abc123", key, "org-1");
    const b = encryptSecret("shpat_abc123", key, "org-1");
    expect(a).not.toBe(b);
    expect(a).not.toContain("shpat_abc123");
    expect(decryptSecret(a, key, "org-1")).toBe("shpat_abc123");
  });
  it("fails on tampering, a wrong key, or use under another organization", () => {
    const sealed = encryptSecret("shpat_abc123", key, "org-1");
    const parts = sealed.split(".");
    const flipped = [...parts.slice(0, 3), Buffer.from("zzzz").toString("base64url") + parts[3].slice(4)].join(".");
    expect(() => decryptSecret(flipped, key, "org-1")).toThrow("Secret could not be decrypted");
    expect(() => decryptSecret(sealed, randomBytes(32).toString("base64"), "org-1")).toThrow("Secret could not be decrypted");
    expect(() => decryptSecret(sealed, key, "org-2")).toThrow("Secret could not be decrypted");
  });
  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16).toString("base64"), "org-1")).toThrow(/32 bytes/);
  });
});

describe("log redaction", () => {
  it("removes credentials and customer details by key and by pattern", () => {
    const out = JSON.stringify(
      redact({
        shop: "example.myshopify.com",
        accessToken: "shpat_0123456789abcdef",
        headers: { Authorization: "Bearer abc.def.ghi", "x-shopify-hmac-sha256": "zzz" },
        customer: { email: "jane@example.com", first_name: "Jane", note: "call jane@example.com" },
        message: "failed with key sk-ant-api03-SECRETSECRET and sb_secret_abcdef123",
        nested: [{ password: "hunter2" }],
        error: new Error("token shpat_deadbeef rejected"),
        orderCount: 3,
      }),
    );
    for (const secret of ["shpat_0123456789abcdef", "abc.def.ghi", "zzz", "jane@example.com", "Jane", "SECRETSECRET", "sb_secret_abcdef123", "hunter2", "shpat_deadbeef"]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).toContain("example.myshopify.com");
    expect(out).toContain('"orderCount":3');
  });
});

describe("environment", () => {
  it("flags secrets exposed through NEXT_PUBLIC_ names", () => {
    expect(findPublicSecretNames({ NEXT_PUBLIC_SUPABASE_URL: "x", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x", NEXT_PUBLIC_SHOPIFY_API_SECRET: "x", NEXT_PUBLIC_ANTHROPIC_API_KEY: "x", SUPABASE_SECRET_KEY: "x" })).toEqual([
      "NEXT_PUBLIC_SHOPIFY_API_SECRET",
      "NEXT_PUBLIC_ANTHROPIC_API_KEY",
    ]);
  });
  it("treats missing or malformed Supabase settings as not configured", () => {
    expect(readPublicEnv({})).toBeNull();
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx" })).toBeNull();
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx" })).not.toBeNull();
  });
  it("names malformed server variables without echoing their values", () => {
    try {
      readServerEnv({ ANTHROPIC_API_KEY: "short-secret" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("ANTHROPIC_API_KEY");
      expect((error as Error).message).not.toContain("short-secret");
    }
  });
});

describe("AI output guard (acceptance criterion 12)", () => {
  const schema = z.strictObject({ title: z.string().min(1).max(120), priceMinor: z.number().int().nonnegative() });
  it("accepts output that matches the schema", () => {
    expect(guardAgentOutput(schema, '{"title":"Silk robe","priceMinor":4500}')).toEqual({ ok: true, data: { title: "Silk robe", priceMinor: 4500 } });
  });
  it("rejects non-JSON, wrong types, missing fields and unexpected extra fields", () => {
    expect(guardAgentOutput(schema, "Sure! Here is the JSON: {}")).toMatchObject({ ok: false, reason: "not_json" });
    expect(guardAgentOutput(schema, '{"title":"x","priceMinor":"45.00"}')).toMatchObject({ ok: false, reason: "schema_violation" });
    expect(guardAgentOutput(schema, '{"title":"x"}')).toMatchObject({ ok: false, reason: "schema_violation" });
    expect(guardAgentOutput(schema, '{"title":"x","priceMinor":1,"approve":true}')).toMatchObject({ ok: false, reason: "schema_violation" });
  });
});
