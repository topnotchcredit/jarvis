import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signIn } from "../actions";
import { AuthForm, Field } from "@/components/auth-form";
import { safeNextPath } from "@/lib/auth/redirects";

export const metadata: Metadata = { title: "Sign in" };

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const notice = params.error === "link" ? "That link has expired or was already used. Sign in or request a new one." : undefined;
  return (
    <AuthForm action={signIn} submitLabel="Sign in" pendingLabel="Signing in…" notice={notice}>
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
    </AuthForm>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="mb-6 text-xl">Sign in</h1>
      <Suspense fallback={<div className="h-56" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
      <p className="mt-6 flex justify-between text-sm text-muted">
        <Link href="/forgot-password" className="underline underline-offset-4 hover:text-bone">Forgot your password?</Link>
        <Link href="/signup" className="underline underline-offset-4 hover:text-bone">Create an account</Link>
      </p>
    </>
  );
}
