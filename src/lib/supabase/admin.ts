import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicEnv, readServerEnv } from "@/lib/env";

/**
 * Elevated client using the Supabase secret key. It BYPASSES Row Level Security.
 * Rules for every caller:
 *   1. Authorize the acting user or job for the specific organization first.
 *   2. Always filter by organization_id explicitly.
 *   3. Never return this client, or raw rows containing credentials, to a component.
 * Returns null when the secret key is not configured.
 */
export function createAdminClient() {
  const publicEnv = readPublicEnv();
  const { SUPABASE_SECRET_KEY } = readServerEnv();
  if (!publicEnv || !SUPABASE_SECRET_KEY) return null;
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
