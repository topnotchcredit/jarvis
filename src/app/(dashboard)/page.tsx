import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, formatUtc, LoadingRows, PageHeader, StatusDot } from "@/components/ui";
import { requireMembership } from "@/lib/auth/session";
import { MILESTONES, PLANNED_SECTIONS } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Executive overview" };

async function Overview() {
  const { organization } = await requireMembership();
  const supabase = await createClient();
  const org = organization.id;
  const count = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org);

  const [brands, stores, connectedStores, pendingApprovals, failingIntegrations, activity] = await Promise.all([
    count("brands").is("deleted_at", null),
    count("stores").is("deleted_at", null),
    count("stores").is("deleted_at", null).eq("status", "connected"),
    count("action_queue").eq("status", "pending_approval"),
    count("integrations").in("health_status", ["degraded", "failing"]),
    supabase.from("audit_logs").select("id, action, target_type, actor_type, created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(6),
  ]);
  const failed = [brands, stores, connectedStores, pendingApprovals, failingIntegrations, activity].some((result) => result.error);
  if (failed) {
    return <EmptyState title="The overview could not be loaded">The database did not answer. Reload the page; if it keeps happening, check the Supabase project status.</EmptyState>;
  }

  const facts = [
    { label: "Brands", value: brands.count ?? 0, href: "/brands" },
    { label: "Stores connected", value: `${connectedStores.count ?? 0} of ${stores.count ?? 0}`, href: "/brands" },
    { label: "Waiting for your approval", value: pendingApprovals.count ?? 0, href: "/approvals" },
    { label: "Integrations with problems", value: failingIntegrations.count ?? 0, href: "/integrations" },
  ];
  const paused = organization.autonomyPausedAt !== null;

  return (
    <div className="space-y-10">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-surface px-5 py-4">
            <dt className="text-sm text-muted">{fact.label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold">
              <Link href={fact.href} className="hover:text-gold">{fact.value}</Link>
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="money-heading">
        <h2 id="money-heading" className="mb-3 text-lg">Revenue and profit</h2>
        <EmptyState title="No sales data yet">
          {(connectedStores.count ?? 0) === 0
            ? "Revenue, costs and contribution profit appear here once a Shopify store is connected and its orders have synced. Until then JARVIS shows nothing rather than a placeholder number."
            : "A store is connected, but order sync is not built yet, so there are no figures to show."}
        </EmptyState>
      </section>

      <section aria-labelledby="autonomy-heading">
        <h2 id="autonomy-heading" className="mb-3 text-lg">Automation</h2>
        <div className="panel px-5 py-4 text-sm">
          <p>
            <StatusDot tone={paused ? "alert" : "idle"} />
            {paused
              ? `Autonomous actions were switched off ${formatUtc(organization.autonomyPausedAt!)}.`
              : "No agents are running. The policy engine and approval rules are in place, but the agent runner has not been built."}
          </p>
          <p className="mt-2 text-muted">
            The switch that stops autonomous actions is in <Link href="/settings" className="underline underline-offset-4 hover:text-bone">Settings</Link>.
          </p>
        </div>
      </section>

      <section aria-labelledby="activity-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="activity-heading" className="text-lg">Recent activity</h2>
          <Link href="/activity" className="text-sm text-muted underline underline-offset-4 hover:text-bone">See all activity</Link>
        </div>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th scope="col">When</th><th scope="col">What</th><th scope="col">By</th></tr>
            </thead>
            <tbody>
              {(activity.data ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-muted">{formatUtc(entry.created_at)}</td>
                  <td>{entry.action}</td>
                  <td className="text-muted">{entry.actor_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="roadmap-heading">
        <h2 id="roadmap-heading" className="mb-1 text-lg">Not built yet</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">These areas are in the menu so the shape of the product is visible, but they hold no data and take no actions today.</p>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Area</th><th scope="col">Arrives with</th></tr>
            </thead>
            <tbody>
              {PLANNED_SECTIONS.map((section) => (
                <tr key={section.slug}>
                  <td><Link href={`/${section.slug}`} className="hover:text-gold">{section.title}</Link></td>
                  <td className="text-muted">Milestone {section.milestone}: {MILESTONES[section.milestone]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Executive overview" lead="Where every brand stands and what needs a decision." />
      <Suspense fallback={<LoadingRows rows={4} />}>
        <Overview />
      </Suspense>
    </>
  );
}
