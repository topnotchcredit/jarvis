import type { Metadata } from "next";

export const metadata: Metadata = { title: "Finish setup" };

const STEPS = [
  { title: "Create a Supabase project", body: "A free project at supabase.com is enough to start. It provides the database and sign-in." },
  { title: "Apply the database migrations", body: "Run the SQL files in supabase/migrations in order, or use `supabase db push`." },
  { title: "Add the project URL and keys", body: "Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY." },
  { title: "Restart the app", body: "Environment values are read at start-up. After a restart this page is replaced by the sign-in screen." },
];

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl">JARVIS is not connected to a database yet</h1>
      <p className="mt-3 text-muted">
        Sign-in and all data live in Supabase, and this deployment has no Supabase settings. Nothing can be shown or saved until it does. The README has the full walkthrough.
      </p>
      <ol className="mt-8 space-y-5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold-deep text-xs text-gold">{index + 1}</span>
            <div>
              <h2 className="font-sans text-base font-semibold tracking-normal">{step.title}</h2>
              <p className="text-sm text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
