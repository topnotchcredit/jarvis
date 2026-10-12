"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canAdminister, requireMembership, requireUser } from "@/lib/auth/session";
import { log } from "@/lib/logging/logger";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const name = z.string().trim().min(1, "Enter a name.").max(120, "Keep the name under 120 characters.");

export async function createOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data });
  if (error) {
    log.error("organization.create_failed", { code: error.code });
    return { error: "The organization could not be created. Try again." };
  }
  redirect("/");
}

const brandInput = z.object({
  name,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as USD."),
});

export async function createBrand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await requireMembership();
  // Checked here for a clear message; the database policy is what actually enforces it.
  if (!canAdminister(membership.role)) return { error: "Only owners and admins can create brands." };
  const parsed = brandInput.safeParse({ name: formData.get("name"), currency: formData.get("currency") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("brands").insert({
    organization_id: membership.organization.id,
    name: parsed.data.name,
    slug: slugify(parsed.data.name),
    base_currency: parsed.data.currency,
    created_by: membership.user.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "A brand with that name already exists." };
    if (error.code === "42501") return { error: "Only owners and admins can create brands." };
    log.error("brand.create_failed", { code: error.code });
    return { error: "The brand could not be created. Try again." };
  }
  revalidatePath("/brands");
  revalidatePath("/");
  return { message: `Created ${parsed.data.name}.` };
}

/**
 * The organization-wide kill switch. Pausing stops any new autonomous mutation at the
 * policy engine; the dashboard itself keeps working. The change is written to the audit
 * log by a database trigger.
 */
export async function setAutonomyPaused(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await requireMembership();
  if (!canAdminister(membership.role)) return { error: "Only owners and admins can change this." };
  const pause = formData.get("pause") === "true";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ autonomy_paused_at: pause ? new Date().toISOString() : null, autonomy_paused_by: pause ? membership.user.id : null })
    .eq("id", membership.organization.id)
    .select("id");
  if (error || !data?.length) {
    log.error("autonomy.toggle_failed", { code: error?.code });
    return { error: "The setting was not changed. Try again." };
  }
  revalidatePath("/", "layout");
  return { message: pause ? "Autonomous actions are off." : "Autonomous actions are allowed again." };
}
