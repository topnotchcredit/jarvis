import type { Metadata } from "next";
import { updatePassword } from "../actions";
import { AuthForm, Field } from "@/components/auth-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-xl">Choose a new password</h1>
      <AuthForm action={updatePassword} submitLabel="Save password" pendingLabel="Saving…">
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required hint="At least 12 characters." />
      </AuthForm>
    </>
  );
}
