import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { SidebarNav } from "@/components/sidebar-nav";
import { StatusDot } from "@/components/ui";
import { requireMembership } from "@/lib/auth/session";

async function AccountBar() {
  const { user, organization, role } = await requireMembership();
  const paused = organization.autonomyPausedAt !== null;
  return (
    <>
      <div className="min-w-0">
        <p className="truncate font-semibold">{organization.name}</p>
        <p className="text-xs text-muted">
          <StatusDot tone={paused ? "alert" : "idle"} />
          {paused ? "Autonomous actions are off" : "No agents are running yet"}
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden text-muted sm:inline">
          {user.email} ({role})
        </span>
        <form action={signOut}>
          <button type="submit" className="btn-quiet">Sign out</button>
        </form>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[17rem_1fr]">
      <aside className="border-b border-line bg-surface lg:border-b-0 lg:border-r">
        <div className="px-6 py-5">
          <p className="font-display text-xl font-semibold tracking-tight">
            JARVIS<span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle" aria-hidden="true" />
          </p>
        </div>
        {/* Small screens: the menu folds away. Large screens: always visible. */}
        <details className="group px-3 pb-3 lg:hidden">
          <summary className="btn-quiet w-full cursor-pointer list-none">Menu</summary>
          <div className="pt-4">
            <Suspense fallback={null}>
              <SidebarNav />
            </Suspense>
          </div>
        </details>
        <div className="hidden px-3 pb-8 lg:block">
          <Suspense fallback={null}>
            <SidebarNav />
          </Suspense>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-8">
          <Suspense fallback={<div className="h-9" />}>
            <AccountBar />
          </Suspense>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
