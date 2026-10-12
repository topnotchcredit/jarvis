"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/redirects";
import { readServerEnv } from "@/lib/env";
import { log } from "@/lib/logging/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string };

const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
// Length is the control that matters; composition rules push people toward weak patterns.
const newPassword = z.string().min(12, "Use at least 12 characters.").max(128);

const TOO_MANY: FormState = { error: "Too many attempts. Wait a few minutes and try again." };

function siteUrl(): string {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (readServerEnv().APP_ENV === "production") throw new Error("SITE_URL must be set in production");
  return "http://localhost:3000";
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1).max(128) }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  // One message for every failure, so the form never reveals which emails have accounts.
  const failed: FormState = { error: "Email or password is incorrect." };
  if (!parsed.success) return failed;
  if (!(await rateLimit("sign_in", 10, 600))) return TOO_MANY;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    log.info("auth.sign_in_failed", { code: error.code });
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first. Check your inbox for the link." };
    return failed;
  }
  redirect(safeNextPath(formData.get("next") as string | null));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: newPassword }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your email and password." };
  if (!(await rateLimit("sign_up", 5, 3600))) return TOO_MANY;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm?next=/` },
  });
  if (error) {
    log.info("auth.sign_up_failed", { code: error.code });
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Choose a longer one." };
    if (error.code === "over_email_send_rate_limit") return TOO_MANY;
    return { error: "We could not create the account. Try again." };
  }
  // Same message whether or not the address was already registered.
  return { message: "Check your email for a confirmation link." };
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = email.safeParse(formData.get("email"));
  const sent: FormState = { message: "If that address has an account, a reset link is on its way." };
  if (!parsed.success) return { error: "Enter a valid email address." };
  if (!(await rateLimit("password_reset", 5, 3600))) return TOO_MANY;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/update-password`,
  });
  if (error) log.info("auth.reset_request_failed", { code: error.code });
  return sent;
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPassword.safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a longer password." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: "This reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    log.info("auth.update_password_failed", { code: error.code });
    return { error: error.code === "same_password" ? "Choose a password you have not used here before." : "We could not update the password. Try again." };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
