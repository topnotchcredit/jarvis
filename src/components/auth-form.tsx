"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/app/(auth)/actions";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
  notice?: string;
};

/** Shared form shell: announces errors to screen readers and disables the button while saving. */
export function AuthForm({ action, submitLabel, pendingLabel, children, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate={false}>
      {children}
      <div aria-live="polite" className="min-h-5 text-sm">
        {state.error ? <p className="text-alert">{state.error}</p> : null}
        {state.message ? <p className="text-ok">{state.message}</p> : null}
        {!state.error && !state.message && notice ? <p className="text-alert">{notice}</p> : null}
      </div>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? input.name;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <input id={id} className="field" aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
