import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/", "/setup", "/api/health", "/api/webhooks/"];
const SIGNED_OUT_ONLY = ["/login", "/signup", "/forgot-password"];

const matches = (pathname: string, list: string[]) =>
  list.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));

/**
 * Runs before every page request. It refreshes the Supabase session cookie and does an
 * optimistic signed-in check for redirects. It is not the security boundary: every page
 * and action re-verifies the session (src/lib/auth/session.ts) and the database enforces
 * Row Level Security.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = readPublicEnv();

  if (!env) {
    if (pathname === "/setup" || pathname === "/api/health") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }
  if (pathname === "/setup") return NextResponse.redirect(new URL("/", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Must run before any redirect decision: verifies the token and refreshes it if needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const redirectTo = (path: string, next?: string) => {
    const url = new URL(path, request.url);
    if (next) url.searchParams.set("next", next);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!signedIn && !matches(pathname, PUBLIC_PATHS)) {
    return redirectTo("/login", pathname === "/" ? undefined : pathname + request.nextUrl.search);
  }
  if (signedIn && matches(pathname, SIGNED_OUT_ONLY)) return redirectTo("/");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
