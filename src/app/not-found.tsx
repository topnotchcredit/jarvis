import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl">Page not found</h1>
      <p className="mt-2 text-muted">That address does not match anything in JARVIS.</p>
      <Link href="/" className="btn-quiet mt-6">Go to the overview</Link>
    </main>
  );
}
