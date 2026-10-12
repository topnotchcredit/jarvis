import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { AuthForm, Field } from "@/components/auth-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 text-xl">Reset your password</h1>
      <p className="mb-6 text-sm text-muted">Enter your email and we will send a link to choose a new password.</p>
      <AuthForm action={requestPasswordReset} submitLabel="Send reset link" pendingLabel="Sending…">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
      </AuthForm>
      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="underline underline-offset-4 hover:text-bone">Back to sign in</Link>
      </p>
    </>
  );
}
