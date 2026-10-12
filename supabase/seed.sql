-- Development seed data. NEVER run against production.
-- Sign up one user in the app first; this attaches sample records to the earliest account.
-- Everything here is fictional and labelled as such; quotes are marked 'assumption'.
do $$
declare
  v_user uuid;
  v_org uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
begin
  select id into v_user from public.users order by created_at limit 1;
  if v_user is null then
    raise notice 'No users yet. Sign up in the app, then run the seed again.';
    return;
  end if;
  insert into public.organizations (id, name, slug, created_by) values (v_org, 'Sample Org (seed data)', 'sample-org-' || left(v_org::text, 8), v_user);
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.brands (id, organization_id, name, slug, base_currency, min_margin_floor_bps, created_by)
    values (v_brand, v_org, 'Sample Brand (seed data)', 'sample-brand', 'USD', 3000, v_user);
  insert into public.suppliers (id, organization_id, brand_id, name, country_code, reliability_notes, created_by)
    values (v_supplier, v_org, v_brand, 'Fictional Supplier Co. (seed data)', 'US', 'Seed record. Not a real supplier.', v_user);
  insert into public.supplier_quotes (organization_id, brand_id, supplier_id, item_description, unit_cost_minor, shipping_per_unit_minor, currency, minimum_order_quantity, lead_time_days, evidence_level, notes, created_by)
    values (v_org, v_brand, v_supplier, 'Sample item', 420, 85, 'USD', 500, 21, 'assumption', 'Seed record. Invented numbers for layout testing only.', v_user);
  insert into public.budget_policies (organization_id, brand_id, max_action_value_minor, daily_limit_minor, monthly_limit_minor, max_actions_per_day, created_by)
    values (v_org, v_brand, 5000, 10000, 100000, 20, v_user);
  insert into public.tasks (organization_id, brand_id, title, created_by) values (v_org, v_brand, 'Connect a Shopify development store', v_user);
end $$;
