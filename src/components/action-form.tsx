"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/(dashboard)/actions";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  buttonClassName?: string;
  className?: string;
};

export function ActionForm({ action, children, submitLabel, pendingLabel, buttonClassName = "btn-primary", className = "" }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" className={buttonClassName} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
      <p aria-live="polite" className="min-h-5 basis-full text-sm">
        {state.error ? <span className="text-alert">{state.error}</span> : null}
        {state.message ? <span className="text-ok">{state.message}</span> : null}
      </p>
    </form>
  );
}
