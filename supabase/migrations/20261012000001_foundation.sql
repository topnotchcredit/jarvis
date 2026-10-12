-- JARVIS migration 0001: identity, tenancy, helpers, audit log.
-- Conventions:
--   * UUID primary keys, timestamptz timestamps, soft deletion via deleted_at.
--   * Money is stored as bigint minor units (cents) plus an explicit ISO-4217 currency code.
--   * Every business row carries organization_id; brand/store ownership is enforced with
--     composite foreign keys so a row can never point at another tenant's brand or store.
--   * Row Level Security is enabled on every table. Tables with no policy for a role are
--     unreachable by that role. Server-side code using the secret key bypasses RLS and must
--     perform its own authorization (see src/lib/auth).

create type public.member_role as enum ('owner', 'admin', 'operator', 'viewer');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- Kill switch: when set, no new autonomous mutation may start anywhere in the organization.
  autonomy_paused_at timestamptz,
  autonomy_paused_by uuid references public.users (id),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- authorization helpers
-- SECURITY DEFINER so policies on organization_members do not recurse into themselves.
create function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and o.deleted_at is null
  );
$$;

create function public.has_org_role(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
      and o.deleted_at is null
  );
$$;

create function public.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------- audit log (append-only)
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an organization that has audit history cannot be hard-deleted.
  organization_id uuid not null references public.organizations (id) on delete restrict,
  brand_id uuid,
  store_id uuid,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_user_id uuid,
  actor_agent_run_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  outcome text not null default 'succeeded' check (outcome in ('succeeded', 'failed', 'blocked')),
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (organization_id, target_type, target_id);

create function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Generic row-change audit trigger for security-relevant configuration tables.
-- Runs as definer so clients cannot skip or forge it. Columns named in TG_ARGV are redacted.
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_org uuid;
  v_uid uuid := (select auth.uid());
  v_col text;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  for i in 0 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if v_new ? v_col then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
    if v_old ? v_col then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
  end loop;
  if tg_table_name = 'organizations' then
    v_org := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;
  end if;
  insert into public.audit_logs (
    organization_id, brand_id, store_id, actor_type, actor_user_id,
    action, target_type, target_id, before_state, after_state
  ) values (
    v_org,
    case when tg_table_name = 'brands' then coalesce(v_new ->> 'id', v_old ->> 'id')::uuid
         else coalesce(v_new ->> 'brand_id', v_old ->> 'brand_id')::uuid end,
    case when tg_table_name = 'stores' then coalesce(v_new ->> 'id', v_old ->> 'id')::uuid
         else coalesce(v_new ->> 'store_id', v_old ->> 'store_id')::uuid end,
    case when v_uid is null then 'system' else 'user' end,
    v_uid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'integration_id', v_old ->> 'integration_id'),
    v_old,
    v_new
  );
  return coalesce(new, old);
end $$;

create trigger organizations_audit after insert or update on public.organizations
  for each row execute function public.audit_row_change();
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- organization bootstrap
-- The only way a signed-in user creates an organization: atomically creates it and makes
-- the caller its owner.
create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_slug text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'organization name must be 1-120 characters' using errcode = '22023';
  end if;
  v_slug := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then v_slug := 'org'; end if;
  v_slug := left(v_slug, 50) || '-' || left(replace(v_id::text, '-', ''), 8);
  insert into public.organizations (id, name, slug, created_by) values (v_id, btrim(p_name), v_slug, v_uid);
  insert into public.organization_members (organization_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

-- ---------------------------------------------------------------- durable rate limiting
-- Fixed-window counter that works across serverless instances. No client table access;
-- callers go through check_rate_limit().
create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);

create function public.check_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or char_length(p_bucket) > 200 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (bucket, window_start) values (p_bucket, v_window)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------- RLS + grants
alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

grant select, update (display_name) on public.users to authenticated;
create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id));
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select, update (name, autonomy_paused_at, autonomy_paused_by) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.member_role[]));

grant select, insert, update (role), delete on public.organization_members to authenticated;
create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
-- Owners and admins manage members; only an owner may grant, change, or remove an owner.
create policy members_insert on public.organization_members for insert to authenticated
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.member_role[]))
  );
create policy members_update on public.organization_members for update to authenticated
  using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.member_role[]))
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.member_role[]))
  );
create policy members_delete on public.organization_members for delete to authenticated
  using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.member_role[]))
  );

-- An organization must always keep at least one owner.
create function public.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (
      select 1 from public.organization_members
      where organization_id = old.organization_id and role = 'owner' and id <> old.id
    ) and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'an organization must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger organization_members_last_owner before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

grant select on public.audit_logs to authenticated;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_org_member(organization_id));
