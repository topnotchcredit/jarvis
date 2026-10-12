import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing route for links in confirmation and password-recovery emails.
 * Supports token-hash links (recommended template) and PKCE `code` links.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  // A relative Location keeps the visitor on the host they used. Building an absolute URL
  // from request.url is wrong behind a proxy, where the internal host differs from the
  // public one and the session cookie would not follow.
  return new Response(null, { status: 303, headers: { Location: ok ? next : "/login?error=link" } });
}
