import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addMember, asAnon, asService, asUser, createBrand, createOrg, createStore, createTestDatabase, createUser,
} from "./harness";

let db: PGlite;
let alice: string, bob: string, carol: string, dave: string, erin: string;
let orgA: string, orgB: string;
let brandA: string, brandA2: string, brandB: string;
let storeA: string, storeA2: string, storeB: string;

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createUser(db, "alice@a.test"); // owner of A
  bob = await createUser(db, "bob@b.test"); // owner of B
  carol = await createUser(db, "carol@a.test"); // admin of A
  dave = await createUser(db, "dave@a.test"); // operator of A
  erin = await createUser(db, "erin@a.test"); // viewer of A
  orgA = await createOrg(db, alice, "Org A");
  orgB = await createOrg(db, bob, "Org B");
  await addMember(db, orgA, carol, "admin");
  await addMember(db, orgA, dave, "operator");
  await addMember(db, orgA, erin, "viewer");
  brandA = await createBrand(db, orgA, "Brand A");
  brandA2 = await createBrand(db, orgA, "Brand A Two");
  brandB = await createBrand(db, orgB, "Brand B");
  storeA = await createStore(db, orgA, brandA, "store-a");
  storeA2 = await createStore(db, orgA, brandA2, "store-a-two");
  storeB = await createStore(db, orgB, brandB, "store-b");
}, 60_000);

const REQUIRED_TABLES = [
  "users", "organizations", "organization_members", "brands", "stores", "integrations", "products",
  "product_variants", "suppliers", "supplier_quotes", "orders", "order_items", "refunds",
  "inventory_snapshots", "expenses", "campaigns", "campaign_metrics", "tasks", "workflows",
  "workflow_runs", "agent_runs", "action_queue", "approvals", "experiments", "experiment_results",
  "daily_metrics", "webhook_events", "audit_logs", "budget_policies", "notification_preferences",
];

describe("schema shape", () => {
  it("creates every table the specification requires", async () => {
    const { rows } = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    const names = rows.map((r) => r.tablename);
    for (const table of REQUIRED_TABLES) expect(names, `missing table ${table}`).toContain(table);
  });

  it("has Row Level Security enabled on every public table", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("never stores money or metrics in floating point columns", async () => {
    const { rows } = await db.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and data_type in ('real', 'double precision', 'money')`,
    );
    expect(rows).toEqual([]);
  });

  it("uses uuid primary keys on every table that has an id column", async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'id' and data_type <> 'uuid'`,
    );
    expect(rows).toEqual([]);
  });

  it("exposes only the intended functions to signed-in clients, and none to anonymous ones", async () => {
    const callable = async (role: string) =>
      (await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`,
        [role],
      )).rows.map((r) => r.proname);
    expect(await callable("anon")).toEqual([]);
    expect(await callable("authenticated")).toEqual(["create_organization", "has_org_role", "is_org_member", "shares_org_with"]);
  });

  it("grants the anon role no table privileges at all", async () => {
    const { rows } = await db.query(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'",
    );
    expect(rows).toEqual([]);
  });
});

describe("organization bootstrap", () => {
  it("makes the creator the owner", async () => {
    const { rows } = await db.query("select role from public.organization_members where organization_id = $1 and user_id = $2", [orgA, alice]);
    expect(rows).toEqual([{ role: "owner" }]);
  });

  it("refuses to create an organization without a signed-in user", async () => {
    await expect(asAnon(db, (tx) => tx.query("select public.create_organization('x')"))).rejects.toThrow(/permission denied/);
  });

  it("mirrors new auth users into public.users", async () => {
    const { rows } = await db.query("select email from public.users where id = $1", [alice]);
    expect(rows).toEqual([{ email: "alice@a.test" }]);
  });
});

describe("tenant isolation (acceptance criteria 2 and 20)", () => {
  it("lets a member read their own organization's records", async () => {
    const rows = await asUser(db, erin, async (tx) => (await tx.query("select id from public.brands order by name")).rows);
    expect(rows).toEqual([{ id: brandA }, { id: brandA2 }]);
  });

  it.each(["organizations", "organization_members", "brands", "stores", "audit_logs"])(
    "hides another organization's %s rows",
    async (table) => {
      const col = table === "organizations" ? "id" : "organization_id";
      const rows = await asUser(db, bob, async (tx) => (await tx.query(`select 1 from public.${table} where ${col} = $1`, [orgA])).rows);
      expect(rows).toEqual([]);
    },
  );

  it("hides users who share no organization", async () => {
    const rows = await asUser(db, bob, async (tx) => (await tx.query<{ id: string }>("select id from public.users")).rows);
    expect(rows.map((r) => r.id)).toEqual([bob]);
  });

  it("blocks inserting a brand into another organization", async () => {
    await expect(
      asUser(db, bob, (tx) => tx.query("insert into public.brands (organization_id, name, slug) values ($1, 'x', 'x')", [orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("silently affects zero rows when updating another organization's brand", async () => {
    const affected = await asUser(db, bob, async (tx) => (await tx.query("update public.brands set name = 'hacked' where id = $1", [brandA])).affectedRows);
    expect(affected).toBe(0);
    const { rows } = await db.query("select name from public.brands where id = $1", [brandA]);
    expect(rows).toEqual([{ name: "Brand A" }]);
  });

  it("rejects a store that points at another organization's brand, even for server code", async () => {
    await expect(
      asService(db, (tx) =>
        tx.query("insert into public.stores (organization_id, brand_id, shop_domain) values ($1, $2, 'x.myshopify.com')", [orgA, brandB]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects an order filed under one brand but another brand's store", async () => {
    await expect(
      asService(db, (tx) =>
        tx.query(
          `insert into public.orders (organization_id, brand_id, store_id, shopify_order_id, currency, processed_at, gross_sales_minor, total_minor)
           values ($1, $2, $3, 'gid://shopify/Order/1', 'USD', now(), 1000, 1000)`,
          [orgA, brandA, storeA2],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects an order that crosses organizations", async () => {
    await expect(
      asService(db, (tx) =>
        tx.query(
          `insert into public.orders (organization_id, brand_id, store_id, shopify_order_id, currency, processed_at, gross_sales_minor, total_minor)
           values ($1, $2, $3, 'gid://shopify/Order/2', 'USD', now(), 1000, 1000)`,
          [orgA, brandA, storeB],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("never lets a row move to another organization", async () => {
    await expect(asService(db, (tx) => tx.query("update public.brands set organization_id = $1 where id = $2", [orgB, brandA2]))).rejects.toThrow(
      /organization_id is immutable/,
    );
  });

  it("allows one live store record per Shopify shop across all tenants", async () => {
    await expect(createStore(db, orgB, brandB, "store-a")).rejects.toThrow(/duplicate key/);
  });
});

describe("roles", () => {
  it("lets a viewer read but not write", async () => {
    await expect(
      asUser(db, erin, (tx) => tx.query("insert into public.suppliers (organization_id, name) values ($1, 'S')", [orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets an operator add suppliers but not brands or budgets", async () => {
    await asUser(db, dave, (tx) => tx.query("insert into public.suppliers (organization_id, name) values ($1, 'Acme')", [orgA]));
    await expect(
      asUser(db, dave, (tx) => tx.query("insert into public.brands (organization_id, name, slug) values ($1, 'N', 'n')", [orgA])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, dave, (tx) => tx.query("insert into public.budget_policies (organization_id, daily_limit_minor) values ($1, 999999)", [orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets an admin create a brand", async () => {
    await asUser(db, carol, (tx) => tx.query("insert into public.brands (organization_id, name, slug) values ($1, 'Carol Brand', 'carol-brand')", [orgA]));
  });

  it("stops an admin from making themselves or anyone else an owner", async () => {
    await expect(
      asUser(db, carol, (tx) => tx.query("update public.organization_members set role = 'owner' where organization_id = $1 and user_id = $2", [orgA, carol])),
    ).rejects.toThrow(/row-level security/);
  });

  it("stops an admin from removing the owner", async () => {
    const affected = await asUser(db, carol, async (tx) =>
      (await tx.query("delete from public.organization_members where organization_id = $1 and user_id = $2", [orgA, alice])).affectedRows,
    );
    expect(affected).toBe(0);
  });

  it("keeps at least one owner in every organization", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query("update public.organization_members set role = 'admin' where organization_id = $1 and user_id = $2", [orgA, alice])),
    ).rejects.toThrow(/at least one owner/);
  });

  it("does not let clients write server-managed tables", async () => {
    for (const sql of [
      `insert into public.stores (organization_id, brand_id, shop_domain) values ('${orgA}', '${brandA}', 'y.myshopify.com')`,
      `insert into public.audit_logs (organization_id, actor_type, action, target_type) values ('${orgA}', 'user', 'x', 'x')`,
      `update public.action_queue set status = 'approved'`,
      `insert into public.approvals (organization_id, action_id, decision, decided_by_user_id, payload_sha256, expires_at) values ('${orgA}', gen_random_uuid(), 'approved', '${alice}', 'h', now())`,
    ]) {
      await expect(asUser(db, alice, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("makes credentials and webhook events unreachable from any client", async () => {
    for (const table of ["integration_secrets", "webhook_events", "rate_limits"]) {
      await expect(asUser(db, alice, (tx) => tx.query(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });
});

describe("audit log (acceptance criterion 22, database-level part)", () => {
  it("records who created a brand, with before and after state", async () => {
    await asUser(db, alice, (tx) => tx.query("insert into public.brands (organization_id, name, slug) values ($1, 'Audited', 'audited')", [orgA]));
    const { rows } = await db.query<{ actor_user_id: string; actor_type: string; after_state: { name: string } }>(
      "select actor_type, actor_user_id, after_state from public.audit_logs where action = 'brands.insert' and after_state ->> 'slug' = 'audited'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe("user");
    expect(rows[0].actor_user_id).toBe(alice);
    expect(rows[0].after_state.name).toBe("Audited");
  });

  it("records engaging the kill switch", async () => {
    await asUser(db, alice, (tx) => tx.query("update public.organizations set autonomy_paused_at = now(), autonomy_paused_by = $2 where id = $1", [orgA, alice]));
    const { rows } = await db.query(
      "select 1 from public.audit_logs where action = 'organizations.update' and organization_id = $1 and before_state ->> 'autonomy_paused_at' is null and after_state ->> 'autonomy_paused_at' is not null",
      [orgA],
    );
    expect(rows).toHaveLength(1);
    await db.query("update public.organizations set autonomy_paused_at = null, autonomy_paused_by = null where id = $1", [orgA]);
  });

  it("cannot be edited or deleted, even by server code", async () => {
    await expect(asService(db, (tx) => tx.query("update public.audit_logs set action = 'x'"))).rejects.toThrow(/append-only/);
    await expect(asService(db, (tx) => tx.query("delete from public.audit_logs"))).rejects.toThrow(/append-only/);
  });

  it("redacts credential ciphertext", async () => {
    await asService(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "insert into public.integrations (organization_id, brand_id, store_id, provider) values ($1, $2, $3, 'shopify') returning id",
        [orgA, brandA, storeA],
      );
      await tx.query("insert into public.integration_secrets (integration_id, organization_id, ciphertext) values ($1, $2, 'TOPSECRET')", [rows[0].id, orgA]);
    });
    const { rows } = await db.query<{ after_state: { ciphertext: string } }>("select after_state from public.audit_logs where action = 'integration_secrets.insert'");
    expect(rows).toHaveLength(1);
    expect(rows[0].after_state.ciphertext).toBe("[redacted]");
    const leak = await db.query("select 1 from public.audit_logs where after_state::text like '%TOPSECRET%' or before_state::text like '%TOPSECRET%'");
    expect(leak.rows).toEqual([]);
  });
});

describe("webhook idempotency (acceptance criterion 6, storage part)", () => {
  it("stores a redelivered event once", async () => {
    const insert = () =>
      asService(db, async (tx) =>
        (await tx.query(
          `insert into public.webhook_events (organization_id, store_id, external_delivery_id, topic, payload_sha256)
           values ($1, $2, 'evt-1', 'orders/create', 'abc') on conflict (provider, store_id, external_delivery_id) do nothing`,
          [orgA, storeA],
        )).affectedRows,
      );
    expect(await insert()).toBe(1);
    expect(await insert()).toBe(0);
    const { rows } = await db.query("select count(*)::int as n from public.webhook_events where external_delivery_id = 'evt-1'");
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe("costs (acceptance criteria 9 and 11, storage part)", () => {
  let orderId: string, variantId: string;
  beforeAll(async () => {
    const product = await db.query<{ id: string }>(
      "insert into public.products (organization_id, brand_id, store_id, shopify_product_id, title) values ($1, $2, $3, 'p1', 'P') returning id",
      [orgA, brandA, storeA],
    );
    const variant = await db.query<{ id: string }>(
      `insert into public.product_variants (organization_id, brand_id, store_id, product_id, shopify_variant_id, price_minor, currency, current_unit_cost_minor)
       values ($1, $2, $3, $4, 'v1', 2500, 'USD', 700) returning id`,
      [orgA, brandA, storeA, product.rows[0].id],
    );
    variantId = variant.rows[0].id;
    const order = await db.query<{ id: string }>(
      `insert into public.orders (organization_id, brand_id, store_id, shopify_order_id, currency, processed_at, gross_sales_minor, total_minor)
       values ($1, $2, $3, 'o1', 'USD', now(), 5000, 5000) returning id`,
      [orgA, brandA, storeA],
    );
    orderId = order.rows[0].id;
  });

  const insertItem = (line: string, cost: number | null, source: string | null) =>
    db.query(
      `insert into public.order_items (organization_id, brand_id, store_id, order_id, variant_id, shopify_line_item_id, title, quantity, unit_price_minor, currency, unit_cost_minor, cost_source)
       values ($1, $2, $3, $4, $5, $6, 'P', 1, 2500, 'USD', $7, $8)`,
      [orgA, brandA, storeA, orderId, variantId, line, cost, source],
    );

  it("stores an unknown cost as NULL and refuses a cost without a source", async () => {
    await insertItem("l-unknown", null, null);
    await expect(insertItem("l-bad", 0, null)).rejects.toThrow(/check constraint/);
    await expect(insertItem("l-bad2", null, "manual")).rejects.toThrow(/check constraint/);
  });

  it("keeps an order's cost snapshot when the variant's current cost changes", async () => {
    await insertItem("l-known", 700, "shopify");
    await db.query("update public.product_variants set current_unit_cost_minor = 950 where id = $1", [variantId]);
    const { rows } = await db.query("select unit_cost_minor from public.order_items where shopify_line_item_id = 'l-known'");
    expect(Number((rows[0] as { unit_cost_minor: number }).unit_cost_minor)).toBe(700);
  });

  it("does not duplicate an order or line item on re-sync", async () => {
    await expect(insertItem("l-known", 700, "shopify")).rejects.toThrow(/duplicate key/);
    await expect(
      db.query(
        `insert into public.orders (organization_id, brand_id, store_id, shopify_order_id, currency, processed_at, gross_sales_minor, total_minor)
         values ($1, $2, $3, 'o1', 'USD', now(), 1, 1)`,
        [orgA, brandA, storeA],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("approvals (acceptance criteria 15 and 16, database-level part)", () => {
  const queueAction = async (opts: { status?: string; expires?: string; requestedBy?: string } = {}) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.action_queue (organization_id, brand_id, action_type, risk_tier, status, requested_by_user_id, idempotency_key, payload_sha256, expires_at)
       values ($1, $2, 'ads.launch_campaign', 'approval_required', $3, $4, gen_random_uuid()::text, 'hash-1', now() + $5::interval) returning id`,
      [orgA, brandA, opts.status ?? "pending_approval", opts.requestedBy ?? dave, opts.expires ?? "1 hour"],
    );
    return rows[0].id;
  };
  const approve = (actionId: string, userId: string, org = orgA, hash = "hash-1") =>
    asService(db, (tx) =>
      tx.query(
        "insert into public.approvals (organization_id, action_id, decision, decided_by_user_id, payload_sha256, expires_at) values ($1, $2, 'approved', $3, $4, now() + interval '1 day')",
        [org, actionId, userId, hash],
      ),
    );

  it("accepts an admin's approval and caps its expiry at the action's expiry", async () => {
    const id = await queueAction();
    await approve(id, carol);
    const action = await db.query("select status from public.action_queue where id = $1", [id]);
    expect(action.rows).toEqual([{ status: "approved" }]);
    const capped = await db.query("select a.expires_at <= q.expires_at as ok from public.approvals a join public.action_queue q on q.id = a.action_id where q.id = $1", [id]);
    expect(capped.rows).toEqual([{ ok: true }]);
  });

  it("rejects approval of an expired action", async () => {
    const id = await queueAction({ expires: "-1 minute" });
    await expect(approve(id, carol)).rejects.toThrow(/expired/);
  });

  it("rejects approval from an operator, a viewer, or someone outside the organization", async () => {
    const id = await queueAction();
    await expect(approve(id, dave)).rejects.toThrow(/owner or admin/);
    await expect(approve(id, erin)).rejects.toThrow(/owner or admin/);
    await expect(approve(id, bob)).rejects.toThrow(/owner or admin/);
  });

  it("rejects an admin approving their own request", async () => {
    const id = await queueAction({ requestedBy: carol });
    await expect(approve(id, carol)).rejects.toThrow(/own action/);
  });

  it("rejects approval of an action that is not awaiting approval, and double approval", async () => {
    const proposed = await queueAction({ status: "proposed" });
    await expect(approve(proposed, carol)).rejects.toThrow(/not awaiting approval/);
    const id = await queueAction();
    await approve(id, carol);
    await expect(approve(id, alice)).rejects.toThrow(/not awaiting approval/);
  });

  it("rejects approving an action through a different organization", async () => {
    const id = await queueAction();
    await expect(approve(id, bob, orgB)).rejects.toThrow(/not found in this organization/);
  });

  it("rejects an approval given for a different payload than the one queued", async () => {
    const id = await queueAction();
    await expect(approve(id, carol, orgA, "hash-of-something-else")).rejects.toThrow(/does not match the action payload/);
  });

  it("does not let a queued action's content, value or expiry be changed afterwards", async () => {
    const id = await queueAction();
    for (const change of [`payload = '{"budget": 999999}'`, "value_minor = 1", "action_type = 'report.generate'", "risk_tier = 'automatic'", "expires_at = now() + interval '1 year'"]) {
      await expect(asService(db, (tx) => tx.query(`update public.action_queue set ${change} where id = $1`, [id])), change).rejects.toThrow(/cannot be altered/);
    }
  });

  it("requires an owning human or agent run on every queued action", async () => {
    await expect(
      db.query(
        "insert into public.action_queue (organization_id, action_type, risk_tier, idempotency_key, payload_sha256, expires_at) values ($1, 'x', 'automatic', 'k-none', 'h', now())",
        [orgA],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("refuses to record a live action as succeeded without external confirmation", async () => {
    const id = await queueAction();
    await db.query("update public.action_queue set dry_run = false where id = $1", [id]);
    await expect(db.query("update public.action_queue set status = 'succeeded' where id = $1", [id])).rejects.toThrow(/check constraint/);
    await db.query(`update public.action_queue set status = 'succeeded', external_confirmation = '{"id":"gid://x"}' where id = $1`, [id]);
  });

  it("blocks a second action with the same idempotency key", async () => {
    const insert = () =>
      db.query(
        "insert into public.action_queue (organization_id, action_type, risk_tier, requested_by_user_id, idempotency_key, payload_sha256, expires_at) values ($1, 'x', 'automatic', $2, 'same-key', 'h', now())",
        [orgA, dave],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit inside a window, then refuses", async () => {
    const hit = async () =>
      (await db.query<{ ok: boolean }>("select public.check_rate_limit('login:test', 3, 3600) as ok")).rows[0].ok;
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
  });

  it("is not callable by browser clients", async () => {
    await expect(asUser(db, alice, (tx) => tx.query("select public.check_rate_limit('x', 1, 1)"))).rejects.toThrow(/permission denied/);
  });
});
