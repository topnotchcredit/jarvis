import type { Metadata } from "next";
import { Suspense } from "react";
import { setAutonomyPaused } from "../actions";
import { ActionForm } from "@/components/action-form";
import { EmptyState, formatUtc, LoadingRows, PageHeader, StatusDot } from "@/components/ui";
import { canAdminister, requireMembership } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings, permissions and budgets" };

const ROLE_NOTES: Record<string, string> = {
  owner: "Everything, including adding other owners.",
  admin: "Manage brands, members, budgets and the autonomy switch. Approve actions.",
  operator: "Record suppliers, quotes, expenses, tasks and experiments.",
  viewer: "Read only.",
};

async function Settings() {
  const { organization, role } = await requireMembership();
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("id, role, created_at, users(email)")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true });
  if (error) return <EmptyState title="Settings could not be loaded">The database did not answer. Reload the page to try again.</EmptyState>;
  const paused = organization.autonomyPausedAt !== null;
  const admin = canAdminister(role);

  return (
    <div className="space-y-10">
      <section aria-labelledby="autonomy" className="panel max-w-2xl px-5 py-5">
        <h2 id="autonomy" className="text-lg">Autonomous actions</h2>
        <p className="mt-2 text-sm">
          <StatusDot tone={paused ? "alert" : "ok"} />
          {paused ? `Off since ${formatUtc(organization.autonomyPausedAt!)}.` : "Allowed, within each brand's limits and approval rules."}
        </p>
        <p className="mt-2 text-sm text-muted">
          Turning this off stops every agent from starting a new change in any store, for every brand, immediately. Reports and this dashboard keep working. Use it if something looks wrong.
        </p>
        {admin ? (
          <ActionForm
            action={setAutonomyPaused}
            submitLabel={paused ? "Allow autonomous actions" : "Stop all autonomous actions"}
            pendingLabel="Saving…"
            buttonClassName={paused ? "btn-quiet" : "btn-danger"}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="pause" value={paused ? "false" : "true"} />
          </ActionForm>
        ) : (
          <p className="mt-4 text-sm text-muted">Only owners and admins can change this.</p>
        )}
      </section>

      <section aria-labelledby="people">
        <h2 id="people" className="mb-3 text-lg">People</h2>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Can</th><th scope="col">Added</th></tr>
            </thead>
            <tbody>
              {(members ?? []).map((member) => {
                const person = Array.isArray(member.users) ? member.users[0] : member.users;
                return (
                  <tr key={member.id}>
                    <td>{(person as { email: string } | null)?.email ?? "Unknown"}</td>
                    <td>{member.role}</td>
                    <td className="text-muted">{ROLE_NOTES[member.role]}</td>
                    <td className="whitespace-nowrap text-muted">{formatUtc(member.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-muted">Inviting people and changing roles from this screen is not built yet. The database already enforces each role.</p>
      </section>

      <section aria-labelledby="budgets">
        <h2 id="budgets" className="mb-3 text-lg">Budgets and limits</h2>
        <EmptyState title="No limits configured">
          The database can hold spending limits, action caps and margin floors per brand and store, and the policy engine is written to apply them. The screen for setting them is not built yet. With no limits set, the engine sends every action that spends money or changes a store to approval.
        </EmptyState>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings, permissions and budgets" lead="People, roles and the switch that stops autonomous actions." />
      <Suspense fallback={<LoadingRows />}>
        <Settings />
      </Suspense>
    </>
  );
}
