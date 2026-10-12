export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <p className="mb-8 font-display text-2xl font-semibold tracking-tight">
        JARVIS<span className="ml-2 inline-block h-2 w-2 rounded-full bg-gold align-middle" aria-hidden="true" />
      </p>
      {children}
    </main>
  );
}
