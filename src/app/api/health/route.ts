import { isSupabaseConfigured } from "@/lib/env";

/** Liveness check for uptime monitors. Reports configuration state, never values. */
export async function GET() {
  return Response.json(
    { status: "ok", supabaseConfigured: isSupabaseConfigured(), time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
