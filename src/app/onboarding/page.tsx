import type { Metadata } from "next";
import { Suspense } from "react";
import { createOrganization } from "@/app/(dashboard)/actions";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Name your organization" };

async function Guard() {
  await requireUser();
  return null;
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <Suspense fallback={null}>
        <Guard />
      </Suspense>
      <h1 className="text-2xl">Name your organization</h1>
      <p className="mt-2 mb-6 text-muted">The organization owns your brands, stores and budgets. You will be its owner and can add other people later.</p>
      <ActionForm action={createOrganization} submitLabel="Create organization" pendingLabel="Creating…" className="space-y-4">
        <div>
          <label htmlFor="org-name" className="mb-1 block text-sm text-muted">Organization name</label>
          <input id="org-name" name="name" className="field" required maxLength={120} autoFocus />
        </div>
      </ActionForm>
    </main>
  );
}
