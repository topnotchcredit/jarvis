import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, formatUtc, LoadingRows, PageHeader } from "@/components/ui";
import { requireMembership } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity and audit logs" };

const PAGE_SIZE = 100;

async function Activity() {
  const { organization } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, target_type, target_id, actor_type, actor_user_id, outcome, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) return <EmptyState title="Activity could not be loaded">The database did not answer. Reload the page to try again.</EmptyState>;
  const entries = data ?? [];
  if (entries.length === 0) return <EmptyState title="Nothing recorded yet">Changes to brands, stores, members, budgets and queued actions are recorded here as they happen.</EmptyState>;

  const actorIds = [...new Set(entries.map((entry) => entry.actor_user_id).filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await supabase.from("users").select("id, email").in("id", actorIds) : { data: [] };
  const emailById = new Map((people ?? []).map((person) => [person.id, person.email]));

  return (
    <>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">By</th><th scope="col">Outcome</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap text-muted">{formatUtc(entry.created_at)}</td>
                <td>{entry.action}</td>
                <td className="text-muted">{entry.target_id ? `${entry.target_type} ${entry.target_id.slice(0, 8)}` : entry.target_type}</td>
                <td className="text-muted">{entry.actor_user_id ? (emailById.get(entry.actor_user_id) ?? "A former member") : entry.actor_type}</td>
                <td className={entry.outcome === "succeeded" ? "text-muted" : "text-alert"}>{entry.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        Showing the latest {entries.length} {entries.length === 1 ? "entry" : "entries"}{entries.length === PAGE_SIZE ? "; older entries are kept but not listed here yet" : ""}. Entries cannot be edited or deleted.
      </p>
    </>
  );
}

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity and audit logs" lead="Who changed what, and when." />
      <Suspense fallback={<LoadingRows rows={6} />}>
        <Activity />
      </Suspense>
    </>
  );
}
