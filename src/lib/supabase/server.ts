import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { readPublicEnv } from "@/lib/env";

export class NotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured");
    this.name = "NotConfiguredError";
  }
}

/**
 * Supabase client acting as the signed-in user. Every query runs under Row Level
 * Security with the user's own session; this client holds no elevated privileges.
 * Create one per request, never share between requests.
 */
export async function createClient() {
  // Read the request first: this marks the caller as request-time work, so it is never
  // executed (or cached) while pages are prerendered at build time.
  const cookieStore = await cookies();
  // Session handling reads the clock (token expiry). `connection()` declares that
  // everything after this point depends on the live request and must never be prefetched
  // or prerendered ahead of it.
  await connection();
  const env = readPublicEnv();
  if (!env) throw new NotConfiguredError();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the session
          // on every request, so there is nothing to persist from here.
        }
      },
    },
  });
}
