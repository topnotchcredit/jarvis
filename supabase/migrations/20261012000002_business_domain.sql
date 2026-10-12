-- JARVIS migration 0002: brands, stores, catalog, orders, finance, marketing,
-- AI runs, action queue, approvals, budgets.

create domain public.currency_code as char(3) check (value ~ '^[A-Z]{3}$');
create domain public.money_minor as bigint; -- integer minor units; may be negative for adjustments

-- ================================================================ brands & stores
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  base_currency public.currency_code not null default 'USD',
  -- Minimum contribution margin, in basis points, below which price changes need approval.
  min_margin_floor_bps integer check (min_margin_floor_bps between 0 and 10000),
  autonomy_paused_at timestamptz,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  platform text not null default 'shopify' check (platform in ('shopify')),
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  display_name text,
  currency public.currency_code,
  iana_timezone text,
  environment text not null default 'development' check (environment in ('development', 'production')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'disconnected', 'error')),
  autonomy_paused_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete restrict,
  unique (id, organization_id),
  unique (id, brand_id, organization_id)
);
-- A Shopify shop can be attached to exactly one live store record across all tenants.
create unique index stores_shop_domain_live_idx on public.stores (platform, shop_domain) where deleted_at is null;
create index stores_brand_idx on public.stores (brand_id);

-- ================================================================ integrations
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  provider text not null check (provider in ('shopify', 'anthropic', 'email', 'sms', 'meta_ads', 'google_ads', 'tiktok_ads')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'revoked', 'error')),
  granted_scopes text[] not null default '{}',
  health_status text not null default 'unknown' check (health_status in ('unknown', 'healthy', 'degraded', 'failing')),
  last_healthy_at timestamptz,
  last_error_code text,          -- short machine code only; never raw provider responses
  consecutive_failures integer not null default 0,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is null or brand_id is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id)
);
create unique index integrations_store_provider_idx on public.integrations (store_id, provider) where store_id is not null;
create index integrations_org_idx on public.integrations (organization_id);

-- Encrypted credentials live apart from integration metadata and are never reachable
-- through the client API (RLS enabled, no policies, no grants).
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  ciphertext text not null,      -- AES-256-GCM, see src/lib/security/crypto.ts
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ================================================================ catalog
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  shopify_product_id text not null,
  title text not null,
  handle text,
  status text not null default 'draft' check (status in ('active', 'draft', 'archived')),
  vendor text,
  product_type text,
  shopify_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (store_id, shopify_product_id),
  unique (id, store_id)
);
create index products_org_brand_idx on public.products (organization_id, brand_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  product_id uuid not null,
  shopify_variant_id text not null,
  shopify_inventory_item_id text,
  sku text,
  title text,
  price_minor public.money_minor not null check (price_minor >= 0),
  compare_at_price_minor public.money_minor check (compare_at_price_minor >= 0),
  currency public.currency_code not null,
  -- NULL means "cost unknown". It is never treated as zero; profitability is labelled partial.
  current_unit_cost_minor public.money_minor check (current_unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete cascade,
  unique (store_id, shopify_variant_id)
);
create index product_variants_product_idx on public.product_variants (product_id);
create index product_variants_sku_idx on public.product_variants (store_id, sku);

-- Every cost a variant has ever had. Order items copy the cost in force when the order
-- was placed, so later cost changes never rewrite history.
create table public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  unit_cost_minor public.money_minor not null check (unit_cost_minor >= 0),
  currency public.currency_code not null,
  effective_from timestamptz not null,
  source text not null check (source in ('shopify', 'supplier_quote', 'manual')),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (variant_id, effective_from)
);

-- ================================================================ suppliers
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  country_code char(2),
  website text,
  contact_email text,
  reliability_notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  unique (id, organization_id)
);
create index suppliers_org_idx on public.suppliers (organization_id);

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid,
  supplier_id uuid not null,
  variant_id uuid references public.product_variants (id) on delete set null,
  item_description text not null,
  unit_cost_minor public.money_minor not null check (unit_cost_minor >= 0),
  shipping_per_unit_minor public.money_minor check (shipping_per_unit_minor >= 0),
  duties_per_unit_minor public.money_minor check (duties_per_unit_minor >= 0),
  currency public.currency_code not null,
  minimum_order_quantity integer check (minimum_order_quantity > 0),
  lead_time_days integer check (lead_time_days >= 0),
  -- Verified = backed by a document from the supplier; estimate/assumption must be shown as such.
  evidence_level text not null default 'assumption' check (evidence_level in ('verified', 'estimate', 'assumption')),
  source_url text,
  quoted_on date,
  valid_until date,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id) references public.brands (id, organization_id)
);
create index supplier_quotes_supplier_idx on public.supplier_quotes (supplier_id);

-- ================================================================ orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  shopify_order_id text not null,
  order_name text,
  currency public.currency_code not null,
  processed_at timestamptz not null,
  cancelled_at timestamptz,
  financial_status text,
  fulfillment_status text,
  -- Shopify-reported totals, kept separately so internal sums can be reconciled against them.
  gross_sales_minor public.money_minor not null,       -- line items before discounts, excl. tax/shipping
  discounts_minor public.money_minor not null default 0,
  shipping_charged_minor public.money_minor not null default 0,
  tax_minor public.money_minor not null default 0,
  total_minor public.money_minor not null,
  customer_ref text,              -- opaque Shopify customer id; no names, emails or addresses here
  shopify_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (store_id, shopify_order_id),
  unique (id, store_id)
);
create index orders_store_processed_idx on public.orders (store_id, processed_at desc);
create index orders_org_brand_processed_idx on public.orders (organization_id, brand_id, processed_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  order_id uuid not null,
  variant_id uuid references public.product_variants (id) on delete set null,
  shopify_line_item_id text not null,
  title text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price_minor public.money_minor not null check (unit_price_minor >= 0),
  discount_minor public.money_minor not null default 0 check (discount_minor >= 0),
  currency public.currency_code not null,
  -- Snapshot of unit cost at order time. NULL = unknown (flagged, never assumed zero).
  unit_cost_minor public.money_minor check (unit_cost_minor >= 0),
  cost_source text check (cost_source in ('shopify', 'supplier_quote', 'manual')),
  created_at timestamptz not null default now(),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade,
  unique (order_id, shopify_line_item_id),
  check ((unit_cost_minor is null) = (cost_source is null))
);
create index order_items_variant_idx on public.order_items (variant_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  order_id uuid not null,
  shopify_refund_id text not null,
  amount_minor public.money_minor not null check (amount_minor >= 0),
  currency public.currency_code not null,
  note text,
  processed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade,
  unique (store_id, shopify_refund_id)
);
create index refunds_order_idx on public.refunds (order_id);

create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  shopify_location_id text not null,
  available integer not null,
  captured_at timestamptz not null default now(),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id)
);
create index inventory_snapshots_variant_idx on public.inventory_snapshots (variant_id, captured_at desc);

-- ================================================================ finance
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  category text not null check (category in (
    'cogs_adjustment', 'shipping_fulfillment', 'payment_fees', 'platform_fees',
    'advertising', 'software', 'ai_usage', 'payroll_contractors', 'other_fixed', 'other_variable')),
  is_fixed boolean not null default false,
  description text,
  amount_minor public.money_minor not null,
  currency public.currency_code not null,
  incurred_on date not null,
  source text not null default 'manual' check (source in ('manual', 'shopify', 'ad_platform', 'system')),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is null or brand_id is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id)
);
create index expenses_org_date_idx on public.expenses (organization_id, incurred_on);

create table public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  store_id uuid not null,
  metric_date date not null,
  metric_key text not null,       -- defined in docs/METRICS.md
  value numeric(20, 4) not null,
  currency public.currency_code,
  completeness text not null check (completeness in ('complete', 'partial', 'estimated')),
  missing_inputs text[] not null default '{}',
  computed_at timestamptz not null default now(),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (store_id, metric_date, metric_key)
);

-- ================================================================ marketing
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid not null,
  store_id uuid,
  channel text not null check (channel in ('meta_ads', 'google_ads', 'tiktok_ads', 'email', 'sms', 'organic', 'other')),
  external_campaign_id text,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'paused', 'ended')),
  daily_budget_minor public.money_minor check (daily_budget_minor >= 0),
  currency public.currency_code,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (id, organization_id)
);
create unique index campaigns_external_idx on public.campaigns (brand_id, channel, external_campaign_id)
  where external_campaign_id is not null;

create table public.campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  metric_date date not null,
  spend_minor public.money_minor not null default 0 check (spend_minor >= 0),
  impressions bigint check (impressions >= 0),
  clicks bigint check (clicks >= 0),
  conversions bigint check (conversions >= 0),
  attributed_revenue_minor public.money_minor,
  currency public.currency_code not null,
  source text not null check (source in ('ad_platform', 'manual')),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete cascade,
  unique (campaign_id, metric_date)
);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid not null,
  store_id uuid,
  name text not null,
  hypothesis text not null,
  primary_metric_key text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'concluded', 'abandoned')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (id, organization_id)
);

create table public.experiment_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  experiment_id uuid not null,
  variant_label text not null,
  sample_size bigint not null check (sample_size >= 0),
  metric_value numeric(20, 6),
  recorded_at timestamptz not null default now(),
  foreign key (experiment_id, organization_id) references public.experiments (id, organization_id) on delete cascade
);

-- ================================================================ work, workflows, AI runs
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  agent text not null check (agent in (
    'research', 'product', 'supplier', 'launch', 'growth', 'finance', 'operations', 'support', 'executive')),
  task text not null,
  model text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'timed_out', 'rejected_schema', 'cancelled')),
  input_refs jsonb not null default '[]',   -- references to records, not copies of customer data
  output jsonb,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  estimated_cost_micros bigint check (estimated_cost_micros >= 0), -- millionths of cost_currency
  cost_currency public.currency_code default 'USD',
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (store_id is null or brand_id is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (id, organization_id)
);
create index agent_runs_org_started_idx on public.agent_runs (organization_id, started_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  details text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  priority smallint not null default 3 check (priority between 1 and 5),
  owner_user_id uuid references public.users (id),
  due_at timestamptz,
  origin text not null default 'human' check (origin in ('human', 'agent', 'system')),
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is null or brand_id is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id)
);
create index tasks_org_status_idx on public.tasks (organization_id, status, due_at);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  name text not null,
  description text,
  trigger_config jsonb not null default '{}',
  definition jsonb not null default '{}',
  enabled boolean not null default false,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  unique (id, organization_id)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workflow_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  attempt integer not null default 1 check (attempt >= 1),
  idempotency_key text not null,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workflow_id, organization_id) references public.workflows (id, organization_id) on delete cascade,
  unique (organization_id, idempotency_key)
);

-- ================================================================ policy: budgets, actions, approvals
create table public.budget_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  action_type text,               -- NULL = applies to every action type in scope
  max_action_value_minor public.money_minor check (max_action_value_minor >= 0),
  daily_limit_minor public.money_minor check (daily_limit_minor >= 0),
  monthly_limit_minor public.money_minor check (monthly_limit_minor >= 0),
  max_actions_per_day integer check (max_actions_per_day >= 0),
  ai_monthly_budget_micros bigint check (ai_monthly_budget_micros >= 0),
  currency public.currency_code not null default 'USD',
  enabled boolean not null default true,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is null or brand_id is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id)
);
create index budget_policies_scope_idx on public.budget_policies (organization_id, brand_id, store_id);

create table public.action_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  action_type text not null,
  risk_tier text not null check (risk_tier in ('automatic', 'conditional', 'approval_required')),
  status text not null default 'proposed' check (status in (
    'proposed', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed',
    'blocked', 'rejected', 'expired', 'cancelled')),
  payload jsonb not null default '{}',
  payload_sha256 text not null,   -- hash of the exact payload; approvals bind to it
  value_minor public.money_minor,
  currency public.currency_code,
  dry_run boolean not null default true,
  requested_by_agent_run_id uuid references public.agent_runs (id) on delete set null,
  requested_by_user_id uuid references public.users (id),
  idempotency_key text not null,
  block_reason text,
  external_confirmation jsonb,    -- proof returned by the external system; required for 'succeeded'
  expires_at timestamptz not null,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is null or brand_id is not null),
  check (requested_by_agent_run_id is not null or requested_by_user_id is not null),
  -- Never record success for a live action without confirmation from the external system.
  check (status <> 'succeeded' or dry_run or external_confirmation is not null),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id),
  foreign key (store_id, brand_id, organization_id) references public.stores (id, brand_id, organization_id),
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);
create index action_queue_org_status_idx on public.action_queue (organization_id, status, created_at desc);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  -- Always a human. There is deliberately no agent column: an AI run cannot be an approver.
  decided_by_user_id uuid not null references public.users (id),
  payload_sha256 text not null,   -- the payload the approver saw
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (action_id, organization_id) references public.action_queue (id, organization_id) on delete cascade,
  unique (action_id)
);

-- An approval is only valid from an owner/admin of the same organization, for an action that
-- is waiting for approval and has not expired, and not from the person who requested it
-- unless they are an owner. Enforced in the database so no code path can skip it.
create function public.validate_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_action public.action_queue%rowtype;
  v_role public.member_role;
begin
  select * into v_action from public.action_queue
    where id = new.action_id and organization_id = new.organization_id for update;
  if not found then
    raise exception 'action not found in this organization' using errcode = '23503';
  end if;
  if v_action.status <> 'pending_approval' then
    raise exception 'action is not awaiting approval (status %)', v_action.status using errcode = '23514';
  end if;
  if v_action.expires_at <= now() then
    raise exception 'action has expired' using errcode = '23514';
  end if;
  if new.payload_sha256 <> v_action.payload_sha256 then
    raise exception 'approval does not match the action payload' using errcode = '23514';
  end if;
  select role into v_role from public.organization_members
    where organization_id = new.organization_id and user_id = new.decided_by_user_id;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'approver must be an owner or admin of the organization' using errcode = '42501';
  end if;
  if v_action.requested_by_user_id = new.decided_by_user_id and v_role <> 'owner' then
    raise exception 'requester cannot approve their own action' using errcode = '42501';
  end if;
  if new.expires_at > v_action.expires_at then
    new.expires_at := v_action.expires_at;
  end if;
  update public.action_queue
    set status = case when new.decision = 'approved' then 'approved' else 'rejected' end
    where id = v_action.id;
  return new;
end $$;
create trigger approvals_validate before insert on public.approvals
  for each row execute function public.validate_approval();

-- What an action will do is fixed when it is queued. Only its lifecycle fields may change.
create function public.action_content_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.action_type is distinct from old.action_type
     or new.payload is distinct from old.payload
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.value_minor is distinct from old.value_minor
     or new.currency is distinct from old.currency
     or new.brand_id is distinct from old.brand_id
     or new.store_id is distinct from old.store_id
     or new.risk_tier is distinct from old.risk_tier
     or new.expires_at > old.expires_at then
    raise exception 'a queued action cannot be altered; cancel it and queue a new one' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger action_queue_content_immutable before update on public.action_queue
  for each row execute function public.action_content_immutable();

create function public.approvals_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'approvals are immutable';
end $$;
create trigger approvals_no_update before update on public.approvals
  for each row execute function public.approvals_immutable();

-- ================================================================ webhooks & notifications
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  provider text not null default 'shopify',
  -- X-Shopify-Webhook-Id: unique per delivery and repeated on retries, so it is the
  -- de-duplication key (per shopify.dev "Verify webhook deliveries", checked 2026-10-12).
  external_delivery_id text not null,
  -- X-Shopify-Event-Id: shared by deliveries caused by the same merchant action.
  external_event_id text,
  topic text not null,
  payload_sha256 text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete cascade,
  unique (provider, store_id, external_delivery_id)
);
create index webhook_events_status_idx on public.webhook_events (status, received_at);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email')),
  event_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, channel, event_type)
);

-- ================================================================ triggers: updated_at + audit
do $$
declare t text;
begin
  foreach t in array array[
    'brands', 'stores', 'integrations', 'integration_secrets', 'products', 'product_variants',
    'suppliers', 'supplier_quotes', 'orders', 'expenses', 'campaigns', 'experiments', 'tasks',
    'workflows', 'budget_policies', 'action_queue', 'notification_preferences'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  -- Consequential configuration and control tables are audited at the database level.
  foreach t in array array[
    'brands', 'stores', 'integrations', 'budget_policies', 'workflows', 'action_queue', 'approvals'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;
create trigger integration_secrets_audit after insert or update or delete on public.integration_secrets
  for each row execute function public.audit_row_change('ciphertext');

-- A row can never be moved to another organization, by anyone.
create function public.prevent_org_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '23514';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'organization_id' and tb.table_type = 'BASE TABLE'
      and c.table_name <> 'audit_logs'
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_org_change()', t || '_org_immutable', t);
  end loop;
end $$;

-- ================================================================ RLS + grants
do $$
declare t text;
begin
  -- Every table: RLS on, members of the owning organization may read.
  foreach t in array array[
    'brands', 'stores', 'integrations', 'products', 'product_variants', 'product_cost_history',
    'suppliers', 'supplier_quotes', 'orders', 'order_items', 'refunds', 'inventory_snapshots',
    'expenses', 'daily_metrics', 'campaigns', 'campaign_metrics', 'experiments', 'experiment_results',
    'agent_runs', 'tasks', 'workflows', 'workflow_runs', 'budget_policies', 'action_queue', 'approvals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_select', t);
  end loop;

  -- Operators and above may create and edit day-to-day planning records directly.
  foreach t in array array['suppliers', 'supplier_quotes', 'expenses', 'experiments', 'tasks'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (public.has_org_role(organization_id, array['owner','admin','operator']::public.member_role[]))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (public.has_org_role(organization_id, array['owner','admin','operator']::public.member_role[]))
      with check (public.has_org_role(organization_id, array['owner','admin','operator']::public.member_role[]))$f$, t || '_update', t);
  end loop;

  -- Brands, budgets and workflow definitions set the structure and limits automation runs
  -- inside: owners and admins only.
  foreach t in array array['brands', 'budget_policies', 'workflows'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]))
      with check (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]))$f$, t || '_update', t);
  end loop;
end $$;

-- Everything else (stores, integrations, synced commerce data, AI runs, the action queue,
-- approvals, metrics) is written only by server-side code after authorization.

-- No client access at all.
alter table public.integration_secrets enable row level security;
alter table public.webhook_events enable row level security;

-- Users manage only their own notification preferences.
alter table public.notification_preferences enable row level security;
grant select, insert, update, delete on public.notification_preferences to authenticated;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

-- Functions are executable by PUBLIC by default, and a per-schema default cannot remove
-- that. Every migration that creates functions ends by revoking it explicitly.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
