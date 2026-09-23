-- Tenancy: customers (organizations), licences, modules, entities, locations, members, RBAC,
-- customer-consented support access, invoices and tamper-evident audit logs.

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  slug          text unique check (slug ~ '^[a-z0-9-]{3,40}$'),   -- reserved for optional per-company subdomains
  status        text not null default 'trial' check (status in ('trial','active','suspended','expired','cancelled')),
  status_reason text,
  trial_ends_at timestamptz,
  industry      text,
  pan           text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tan           text check (tan is null or tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  gstin         text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address       jsonb not null default '{}'::jsonb,
  timezone      text not null default 'Asia/Kolkata',
  logo_path     text,
  data_region   text not null default 'ap-south-1',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.organization_licenses (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  plan_id                uuid not null references public.plans(id),
  seats_total            integer not null check (seats_total >= 1),
  billing_cycle          text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  next_billing_at        date,
  block_over_allocation  boolean not null default true,   -- block adding employees beyond seats_total
  grace_days             integer not null default 7 check (grace_days between 0 and 60),
  custom_price_per_seat_paise integer check (custom_price_per_seat_paise is null or custom_price_per_seat_paise >= 0),
  updated_at             timestamptz not null default now()
);
create trigger trg_org_licenses_touch before update on public.organization_licenses
  for each row execute function app.touch_updated_at();

create table public.organization_modules (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  module_code text not null references public.modules(code),
  enabled     boolean not null default false,
  enabled_by  uuid,
  enabled_at  timestamptz,
  primary key (org_id, module_code)
);

-- Module rules: core cannot be disabled; a module needs its dependencies; disabling checks dependants.
create or replace function app.check_module_dependencies() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.modules%rowtype;
  missing text;
  dependant text;
begin
  select * into m from public.modules where code = new.module_code;
  if new.enabled then
    select d into missing
    from unnest(m.depends_on) d
    where not exists (
      select 1 from public.organization_modules om
      where om.org_id = new.org_id and om.module_code = d and om.enabled
    ) limit 1;
    if missing is not null then
      raise exception 'Module % requires module % to be enabled first', new.module_code, missing using errcode = '23514';
    end if;
    new.enabled_at := coalesce(new.enabled_at, now());
  else
    if m.is_core then
      raise exception 'Core module % cannot be disabled', new.module_code using errcode = '23514';
    end if;
    select om.module_code into dependant
    from public.organization_modules om
    join public.modules mm on mm.code = om.module_code
    where om.org_id = new.org_id and om.enabled and new.module_code = any (mm.depends_on) limit 1;
    if dependant is not null then
      raise exception 'Module % is required by enabled module %', new.module_code, dependant using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_org_modules_deps before insert or update on public.organization_modules
  for each row execute function app.check_module_dependencies();

-- Multi-entity: PF / ESI / TAN / GSTIN registrations belong to a legal entity, not the tenant.
create table public.legal_entities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null,
  pan           text,
  tan           text,
  gstin         text,
  pf_code       text,            -- EPFO establishment code
  esi_code      text,            -- ESIC employer code
  address       jsonb not null default '{}'::jsonb,
  state_code    text references public.states(code),
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (id, org_id)
);
create index on public.legal_entities (org_id);
create unique index legal_entities_one_default on public.legal_entities (org_id) where is_default;

create table public.locations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  entity_id         uuid,
  name              text not null,
  city              text,
  state_code        text not null references public.states(code),   -- drives Professional Tax, LWF, S&E rules
  address           text,
  lat               numeric(9,6),
  lng               numeric(9,6),
  geofence_radius_m integer not null default 100 check (geofence_radius_m between 20 and 5000),
  timezone          text not null default 'Asia/Kolkata',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (id, org_id),
  foreign key (entity_id, org_id) references public.legal_entities (id, org_id)
);
create index on public.locations (org_id);

-- ---------------------------------------------------------------------------------------------
-- Members and RBAC
-- ---------------------------------------------------------------------------------------------
create table public.org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null,
  role        text not null check (role in ('owner','hr_admin','payroll_admin','finance_approver','manager','recruiter','auditor','employee')),
  employee_id uuid,               -- FK added in 0004
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.org_members (user_id) where is_active;
create index on public.org_members (org_id);

create table public.default_org_role_permissions (
  role       text not null,
  permission text not null,
  primary key (role, permission)
);

create table public.org_role_permissions (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  role       text not null,
  permission text not null,
  primary key (org_id, role, permission)
);

-- ---------------------------------------------------------------------------------------------
-- Access helpers used by every policy. SECURITY DEFINER so they can read org_members without
-- recursing into its own policies.
-- ---------------------------------------------------------------------------------------------
create or replace function app.org_is_usable(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organizations o
    where o.id = org
      and (o.status = 'active' or (o.status = 'trial' and (o.trial_ends_at is null or o.trial_ends_at > now())))
  )
$$;

create or replace function app.user_org_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id from public.org_members m
  where m.user_id = app.uid() and m.is_active and app.org_is_usable(m.org_id)
$$;

create or replace function app.can(org uuid, perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.org_is_usable(org) and exists (
    select 1
    from public.org_members m
    join public.org_role_permissions p on p.org_id = m.org_id and p.role = m.role
    where m.user_id = app.uid() and m.org_id = org and m.is_active
      and (p.permission = perm or p.permission = '*')
  )
$$;

-- Same as app.can but also requires MFA (AAL2). Used for payroll, statutory and other sensitive data.
create or replace function app.can_mfa(org uuid, perm text) returns boolean
language sql stable as $$
  select app.aal2() and app.can(org, perm)
$$;

create or replace function app.my_employee_id(org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.employee_id from public.org_members m
  where m.user_id = app.uid() and m.org_id = org and m.is_active and app.org_is_usable(org)
$$;

-- ---------------------------------------------------------------------------------------------
-- Support access: HumaNest support can look at a customer's data only while the customer's owner
-- has approved a time-boxed grant (max 24 hours). Read-only, never payroll or statutory identifiers.
-- ---------------------------------------------------------------------------------------------
create table public.support_access_grants (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  platform_user_id uuid not null references public.platform_users(id),
  reason           text not null check (length(reason) >= 10),
  requested_at     timestamptz not null default now(),
  approved_by      uuid,
  approved_at      timestamptz,
  starts_at        timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  check (expires_at is null or starts_at is null or (expires_at > starts_at and expires_at <= starts_at + interval '24 hours'))
);
create index on public.support_access_grants (org_id);
create index on public.support_access_grants (platform_user_id);

create or replace function app.has_support_grant(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.platform_can('support_access') and exists (
    select 1 from public.support_access_grants g
    where g.org_id = org and g.platform_user_id = app.uid()
      and g.approved_by is not null and g.revoked_at is null
      and now() between g.starts_at and g.expires_at
  )
$$;

-- Read access for general tenant data: the customer's own staff, or approved support.
create or replace function app.can_read(org uuid, perm text) returns boolean
language sql stable as $$
  select app.can(org, perm) or app.has_support_grant(org)
$$;

-- ---------------------------------------------------------------------------------------------
-- Invoices (SaaS billing from HumaNest to the customer). GST is computed by the billing service.
-- ---------------------------------------------------------------------------------------------
create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete restrict,
  invoice_no    text not null unique,
  period_start  date not null,
  period_end    date not null,
  seats         integer not null check (seats >= 0),
  amount_paise  bigint not null check (amount_paise >= 0),
  gst_paise     bigint not null default 0 check (gst_paise >= 0),
  total_paise   bigint generated always as (amount_paise + gst_paise) stored,
  status        text not null default 'draft' check (status in ('draft','issued','paid','overdue','void')),
  issued_at     timestamptz,
  due_at        date,
  paid_at       timestamptz,
  irn           text,             -- e-invoice reference when e-invoicing applies
  created_at    timestamptz not null default now(),
  check (period_end >= period_start)
);
create index on public.invoices (org_id, period_start desc);

-- ---------------------------------------------------------------------------------------------
-- Audit logs (append-only, hash chained)
-- ---------------------------------------------------------------------------------------------
create table public.platform_audit_logs (
  seq         bigint generated always as identity primary key,
  id          uuid not null default gen_random_uuid(),
  org_id      uuid,                       -- customer affected, if any (no FK: logs must outlive customers)
  actor_id    uuid,
  actor_email text,
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip          inet,
  created_at  timestamptz not null default now(),
  prev_hash   text,
  row_hash    text
);
create trigger trg_platform_audit_chain before insert on public.platform_audit_logs
  for each row execute function app.audit_chain();
create trigger trg_platform_audit_immutable before update or delete on public.platform_audit_logs
  for each row execute function app.deny_modification();

create table public.audit_logs (
  seq         bigint generated always as identity primary key,
  id          uuid not null default gen_random_uuid(),
  org_id      uuid not null,               -- no FK: history outlives the customer record
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip          inet,
  created_at  timestamptz not null default now(),
  prev_hash   text,
  row_hash    text
);
create index on public.audit_logs (org_id, seq desc);
create index on public.audit_logs (org_id, entity_type, entity_id);
create trigger trg_audit_chain before insert on public.audit_logs
  for each row execute function app.audit_chain();
create trigger trg_audit_immutable before update or delete on public.audit_logs
  for each row execute function app.deny_modification();

create or replace function app.log_event(org uuid, p_action text, p_entity_type text, p_entity_id text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs (org_id, actor_id, actor_role, action, entity_type, entity_id, detail)
  values (org, app.uid(),
          (select m.role from public.org_members m where m.user_id = app.uid() and m.org_id = org limit 1),
          p_action, p_entity_type, p_entity_id, p_detail);
end $$;

create or replace function app.log_platform_event(p_action text, p_org uuid, p_entity_type text, p_entity_id text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.platform_audit_logs (org_id, actor_id, actor_email, action, entity_type, entity_id, detail)
  values (p_org, app.uid(), (select email from public.platform_users where id = app.uid()), p_action, p_entity_type, p_entity_id, p_detail);
end $$;

-- Generic row-change audit trigger. Attach with: create trigger ... execute function app.audit_row('org_id');
-- Encrypted columns (suffix _enc) are never copied into the log.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  k text;
  org uuid;
  rec jsonb := coalesce(n, o);
begin
  for k in select jsonb_object_keys(rec) loop
    if k like '%\_enc' then
      if o is not null then o := o - k; end if;
      if n is not null then n := n - k; end if;
    end if;
  end loop;
  org := (rec ->> 'org_id')::uuid;
  if tg_op = 'UPDATE' and o = n then return new; end if;
  insert into public.audit_logs (org_id, actor_id, actor_role, action, entity_type, entity_id, detail)
  values (org, app.uid(),
          (select m.role from public.org_members m where m.user_id = app.uid() and m.org_id = org limit 1),
          lower(tg_op), tg_table_name, coalesce(rec ->> 'id', rec ->> 'employee_id'),
          jsonb_build_object('old', o, 'new', n));
  return coalesce(new, old);
end $$;

create or replace function app.verify_audit_chain(org uuid) returns table (ok boolean, first_bad_seq bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  prev text := repeat('0', 64);
  h text;
begin
  for r in select * from public.audit_logs where org_id = org order by seq loop
    h := encode(extensions.digest(prev || coalesce(r.actor_id::text, '') || r.action || coalesce(r.entity_type, '') ||
                       coalesce(r.entity_id, '') || coalesce(r.detail::text, '') || r.created_at::text, 'sha256'), 'hex');
    if r.prev_hash <> prev or r.row_hash <> h then
      return query select false, r.seq; return;
    end if;
    prev := r.row_hash;
  end loop;
  return query select true, null::bigint;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Provisioning (called by the admin portal's server with the service role)
-- ---------------------------------------------------------------------------------------------
create or replace function app.provision_customer(
  p_name text, p_owner_user uuid, p_plan text, p_seats integer, p_trial_days integer default 14,
  p_modules text[] default '{employee_core}', p_created_by uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid;
  plan_row public.plans%rowtype;
  m record;
begin
  select * into plan_row from public.plans where code = p_plan and is_active;
  if not found then raise exception 'Unknown plan %', p_plan; end if;
  if plan_row.max_seats is not null and p_seats > plan_row.max_seats then
    raise exception 'Plan % allows at most % seats', p_plan, plan_row.max_seats;
  end if;
  insert into public.organizations (name, status, trial_ends_at, created_by)
  values (p_name, case when p_trial_days > 0 then 'trial' else 'active' end,
          case when p_trial_days > 0 then now() + make_interval(days => p_trial_days) end, p_created_by)
  returning id into org;
  insert into public.organization_licenses (org_id, plan_id, seats_total, next_billing_at)
  values (org, plan_row.id, p_seats, (now() + make_interval(days => greatest(p_trial_days, 0)))::date);
  -- Requested modules plus everything they depend on, inserted in dependency order (shallowest first)
  for m in
    with recursive want(code) as (
      select code from public.modules where code = any (p_modules) or is_core
      union
      select d from public.modules mm join want w on w.code = mm.code, unnest(mm.depends_on) d
    ), depth(code, d) as (
      select code, 0 from public.modules where cardinality(depends_on) = 0
      union all
      select mm.code, dp.d + 1 from public.modules mm join depth dp on dp.code = any (mm.depends_on)
    ), depth_max as (select code, max(d) d from depth group by code)
    select dm.code, exists (select 1 from want w where w.code = dm.code) as wanted
    from depth_max dm order by dm.d, dm.code
  loop
    insert into public.organization_modules (org_id, module_code, enabled, enabled_by)
    values (org, m.code, m.wanted, p_created_by);
  end loop;
  insert into public.org_role_permissions (org_id, role, permission)
  select org, role, permission from public.default_org_role_permissions;
  insert into public.org_members (org_id, user_id, role) values (org, p_owner_user, 'owner');
  insert into public.legal_entities (org_id, name, is_default) values (org, p_name, true);
  insert into public.platform_audit_logs (org_id, actor_id, action, entity_type, entity_id, detail)
  values (org, p_created_by, 'customer.created', 'organization', org::text, jsonb_build_object('plan', p_plan, 'seats', p_seats, 'trial_days', p_trial_days));
  return org;
end $$;

-- Customers may edit their own profile (name, address, logo) but never their lifecycle fields.
create or replace function app.protect_org_columns() returns trigger
language plpgsql as $$
begin
  if app.platform_can('manage_customers') or current_user in ('postgres', 'service_role') then
    return new;
  end if;
  if new.status is distinct from old.status or new.status_reason is distinct from old.status_reason
     or new.trial_ends_at is distinct from old.trial_ends_at or new.slug is distinct from old.slug
     or new.data_region is distinct from old.data_region or new.created_by is distinct from old.created_by then
    raise exception 'Only HumaNest staff can change an organisation''s status, trial, slug or data region' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_org_protect before update on public.organizations
  for each row execute function app.protect_org_columns();

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.organizations              enable row level security;
alter table public.organization_licenses      enable row level security;
alter table public.organization_modules       enable row level security;
alter table public.legal_entities             enable row level security;
alter table public.locations                  enable row level security;
alter table public.org_members                enable row level security;
alter table public.default_org_role_permissions enable row level security;
alter table public.org_role_permissions       enable row level security;
alter table public.support_access_grants      enable row level security;
alter table public.invoices                   enable row level security;
alter table public.platform_audit_logs        enable row level security;
alter table public.audit_logs                 enable row level security;

-- organizations
create policy org_select on public.organizations for select to authenticated
  using (id in (select app.user_org_ids()) or app.platform_can('manage_customers') or app.platform_can('support_access')
         or app.platform_can('manage_licenses') or app.platform_can('view_revenue'));
create policy org_update_owner on public.organizations for update to authenticated
  using (app.can(id, 'settings.write')) with check (app.can(id, 'settings.write'));
create policy org_platform_write on public.organizations for all to authenticated
  using (app.platform_can('manage_customers')) with check (app.platform_can('manage_customers'));

-- licences and modules: customers read their own, only HumaNest staff write
create policy lic_select on public.organization_licenses for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.platform_can('manage_licenses') or app.platform_can('manage_customers')
         or app.platform_can('view_revenue'));
create policy lic_write on public.organization_licenses for all to authenticated
  using (app.platform_can('manage_licenses')) with check (app.platform_can('manage_licenses'));

create policy orgmod_select on public.organization_modules for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.platform_can('edit_modules') or app.platform_can('manage_customers')
         or app.platform_can('support_access'));
create policy orgmod_write on public.organization_modules for all to authenticated
  using (app.platform_can('edit_modules')) with check (app.platform_can('edit_modules'));

-- entities and locations
create policy entities_select on public.legal_entities for select to authenticated using (app.can_read(org_id, 'settings.read'));
create policy entities_write on public.legal_entities for all to authenticated
  using (app.can(org_id, 'settings.write')) with check (app.can(org_id, 'settings.write'));
create policy locations_select on public.locations for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.has_support_grant(org_id));
create policy locations_write on public.locations for all to authenticated
  using (app.can(org_id, 'settings.write')) with check (app.can(org_id, 'settings.write'));

-- members: see yourself; staff with members.read see the org; members.manage changes roles
create policy members_select on public.org_members for select to authenticated
  using (user_id = app.uid() or app.can(org_id, 'members.read') or app.has_support_grant(org_id));
create policy members_write on public.org_members for all to authenticated
  using (app.can_mfa(org_id, 'members.manage')) with check (app.can_mfa(org_id, 'members.manage'));

create policy defperm_select on public.default_org_role_permissions for select to authenticated using (true);
create policy defperm_write on public.default_org_role_permissions for all to authenticated
  using (app.platform_can('manage_platform_users')) with check (app.platform_can('manage_platform_users'));

create policy roleperm_select on public.org_role_permissions for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy roleperm_write on public.org_role_permissions for all to authenticated
  using (app.can_mfa(org_id, 'members.manage')) with check (app.can_mfa(org_id, 'members.manage'));

-- support grants: support requests, the customer's owner approves, both can read
create policy grants_select on public.support_access_grants for select to authenticated
  using (platform_user_id = app.uid() or app.can(org_id, 'members.manage') or app.platform_can('manage_customers'));
create policy grants_request on public.support_access_grants for insert to authenticated
  with check (platform_user_id = app.uid() and app.platform_can('support_access') and approved_by is null);
create policy grants_approve on public.support_access_grants for update to authenticated
  using (app.can_mfa(org_id, 'members.manage')) with check (app.can_mfa(org_id, 'members.manage') and approved_by = app.uid());

-- invoices
create policy invoices_select on public.invoices for select to authenticated
  using (app.can(org_id, 'billing.read') or app.platform_can('view_revenue') or app.platform_can('manage_licenses'));
create policy invoices_write on public.invoices for all to authenticated
  using (app.platform_can('manage_licenses')) with check (app.platform_can('manage_licenses'));

-- audit logs are read-only for everyone; rows arrive through app.log_event / triggers
create policy platform_audit_select on public.platform_audit_logs for select to authenticated
  using (app.platform_can('view_audit_logs'));
create policy audit_select on public.audit_logs for select to authenticated
  using (app.can_mfa(org_id, 'audit.read'));
