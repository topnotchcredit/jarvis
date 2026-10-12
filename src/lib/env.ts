import { z } from "zod";

/**
 * Environment access. Values are read lazily so the app can boot (and show a setup
 * screen) before every integration is configured. Nothing here is ever logged.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  // 32 random bytes, base64. Encrypts integration credentials at rest.
  JARVIS_ENCRYPTION_KEY: z.string().min(40).optional(),
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  SHOPIFY_API_KEY: z.string().min(10).optional(),
  SHOPIFY_API_SECRET: z.string().min(10).optional(),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

const emptyToUndefined = (source: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]));

export function readPublicEnv(source: Record<string, string | undefined> = {
  // Listed explicitly: Next.js only inlines NEXT_PUBLIC_ values that are referenced by full name.
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}): PublicEnv | null {
  const parsed = publicSchema.safeParse(emptyToUndefined(source));
  return parsed.success ? parsed.data : null;
}

export function isSupabaseConfigured(): boolean {
  return readPublicEnv() !== null;
}

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("Server environment was requested in the browser");
  }
  const parsed = serverSchema.safeParse(emptyToUndefined(source));
  if (!parsed.success) {
    // Report which variables are malformed, never their values.
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${names}`);
  }
  return parsed.data;
}

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE|ENCRYPTION|API_KEY)/i;

/**
 * Names of browser-exposed variables that look like secrets. Anything prefixed
 * NEXT_PUBLIC_ is compiled into client JavaScript. Checked by `npm run check:env`
 * and at server start.
 */
export function findPublicSecretNames(source: Record<string, string | undefined> = process.env): string[] {
  return Object.keys(source).filter((name) => name.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(name));
}
