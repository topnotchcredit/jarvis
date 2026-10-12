import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "../actions";
import { AuthForm, Field } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-xl">Create an account</h1>
      <AuthForm action={signUp} submitLabel="Create account" pendingLabel="Creating account…">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required hint="At least 12 characters. A few unrelated words works well." />
      </AuthForm>
      <p className="mt-6 text-sm text-muted">
        Already have an account? <Link href="/login" className="underline underline-offset-4 hover:text-bone">Sign in</Link>
      </p>
    </>
  );
}
