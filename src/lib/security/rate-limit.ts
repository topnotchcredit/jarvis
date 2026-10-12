import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { log } from "@/lib/logging/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Durable fixed-window rate limit backed by Postgres (public.check_rate_limit), so it
 * holds across serverless instances. The caller's IP is hashed before it is stored.
 *
 * Returns true when the request may proceed. If the secret key is not configured the
 * limiter cannot run; it then allows the request and logs a warning, leaving Supabase
 * Auth's own built-in limits as the only protection. Configure the key in production.
 */
export async function rateLimit(action: string, limit: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) {
    log.warn("rate_limit.unavailable", { action });
    return true;
  }
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
  const bucket = `${action}:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed: if the limiter itself is broken, do not allow unlimited attempts.
    log.error("rate_limit.failed", { action, code: error.code });
    return false;
  }
  return data === true;
}
