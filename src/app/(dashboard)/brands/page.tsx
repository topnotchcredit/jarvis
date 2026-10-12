import type { Metadata } from "next";
import { Suspense } from "react";
import { createBrand } from "../actions";
import { ActionForm } from "@/components/action-form";
import { EmptyState, formatUtc, LoadingRows, PageHeader, StatusDot } from "@/components/ui";
import { canAdminister, requireMembership } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Brands and stores" };

type StoreRow = { id: string; shop_domain: string; status: string; environment: string; deleted_at: string | null };
type BrandRow = { id: string; name: string; base_currency: string; created_at: string; autonomy_paused_at: string | null; stores: StoreRow[] };

async function Brands() {
  const { organization, role } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, base_currency, created_at, autonomy_paused_at, stores(id, shop_domain, status, environment, deleted_at)")
    .eq("organization_id", organization.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return <EmptyState title="Brands could not be loaded">The database did not answer. Reload the page to try again.</EmptyState>;
  const brands = (data ?? []) as BrandRow[];

  return (
    <div className="space-y-8">
      {brands.length === 0 ? (
        <EmptyState title="No brands yet">
          A brand groups one or more Shopify stores with its own budgets, margin floor and permissions.
          {canAdminister(role) ? " Create the first one below." : " Ask an owner or admin to create one."}
        </EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Brand</th><th scope="col">Currency</th><th scope="col">Stores</th><th scope="col">Created</th></tr>
            </thead>
            <tbody>
              {brands.map((brand) => {
                const stores = brand.stores.filter((store) => store.deleted_at === null);
                return (
                  <tr key={brand.id}>
                    <td className="font-semibold">{brand.name}</td>
                    <td>{brand.base_currency}</td>
                    <td>
                      {stores.length === 0 ? (
                        <span className="text-muted">No store connected</span>
                      ) : (
                        <ul>
                          {stores.map((store) => (
                            <li key={store.id}>
                              <StatusDot tone={store.status === "connected" ? "ok" : store.status === "error" ? "alert" : "idle"} />
                              {store.shop_domain} <span className="text-muted">({store.status}, {store.environment})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{formatUtc(brand.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canAdminister(role) ? (
        <section aria-labelledby="new-brand" className="panel max-w-xl px-5 py-5">
          <h2 id="new-brand" className="mb-4 text-lg">Create a brand</h2>
          <ActionForm action={createBrand} submitLabel="Create brand" pendingLabel="Creating…" className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label htmlFor="brand-name" className="mb-1 block text-sm text-muted">Brand name</label>
              <input id="brand-name" name="name" className="field" required maxLength={120} />
            </div>
            <div className="w-28">
              <label htmlFor="brand-currency" className="mb-1 block text-sm text-muted">Currency</label>
              <input id="brand-currency" name="currency" className="field uppercase" defaultValue="USD" required pattern="[A-Za-z]{3}" maxLength={3} />
            </div>
          </ActionForm>
        </section>
      ) : null}

      <p className="max-w-2xl text-sm text-muted">
        Connecting a Shopify store is not available yet. It arrives with the Shopify milestone, starting read-only against a development store.
      </p>
    </div>
  );
}

export default function BrandsPage() {
  return (
    <>
      <PageHeader title="Brands and stores" lead="The brands you run and the Shopify stores attached to them." />
      <Suspense fallback={<LoadingRows />}>
        <Brands />
      </Suspense>
    </>
  );
}
