import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };
export type MemberRole = "owner" | "admin" | "operator" | "viewer";
export type Membership = {
  user: SessionUser;
  role: MemberRole;
  organization: { id: string; name: string; autonomyPausedAt: string | null };
};

/**
 * The single place the session is read. `getClaims()` verifies the JWT signature
 * (locally with the project's signing keys, or with the Auth server), so the
 * identity cannot be forged by editing cookies. Deduplicated per request.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The signed-in user's organization and role. Loaded through RLS, so it can only
 * ever return an organization the user belongs to. Users without one go to onboarding.
 */
export const requireMembership = cache(async (): Promise<Membership> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, created_at, organizations!inner(id, name, autonomy_paused_at, deleted_at)")
    .eq("user_id", user.id)
    .is("organizations.deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error("Could not load your organization");
  const row = data?.[0];
  if (!row) redirect("/onboarding");
  const org = (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) as {
    id: string;
    name: string;
    autonomy_paused_at: string | null;
  };
  return {
    user,
    role: row.role as MemberRole,
    organization: { id: org.id, name: org.name, autonomyPausedAt: org.autonomy_paused_at },
  };
});

export function canAdminister(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}
