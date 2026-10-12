"use client";

/** Last-resort error screen. Shows a reference code only; details stay in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="mt-2 text-muted">The page could not be shown. Nothing was changed by this error.</p>
      {error.digest ? <p className="mt-2 text-sm text-muted">Reference: {error.digest}</p> : null}
      <button type="button" onClick={reset} className="btn-quiet mt-6">Try again</button>
    </main>
  );
}
