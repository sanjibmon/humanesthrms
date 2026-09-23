-- Platform (HumaNest staff) users, RBAC, plans, modules and the statutory reference data.

-- ---------------------------------------------------------------------------------------------
-- HumaNest staff. One login, role decides what they can do. Every platform permission requires AAL2.
-- ---------------------------------------------------------------------------------------------
create table public.platform_users (
  id            uuid primary key,                 -- same id as the auth user
  email         text not null unique,
  full_name     text not null,
  role          text not null check (role in ('super_admin','support','sales','finance')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  last_login_ip inet,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_platform_users_touch before update on public.platform_users
  for each row execute function app.touch_updated_at();

create table public.platform_permissions (
  code        text primary key,
  description text not null
);

create table public.platform_role_permissions (
  role       text not null check (role in ('super_admin','support','sales','finance')),
  permission text not null references public.platform_permissions(code) on delete cascade,
  primary key (role, permission)
);

create or replace function app.platform_can(perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.aal2() and exists (
    select 1
    from public.platform_users u
    join public.platform_role_permissions rp on rp.role = u.role
    where u.id = app.uid() and u.is_active and rp.permission = perm
  )
$$;

create or replace function app.is_platform_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.aal2() and exists (select 1 from public.platform_users where id = app.uid() and is_active)
$$;

-- ---------------------------------------------------------------------------------------------
-- Plans and modules
-- ---------------------------------------------------------------------------------------------
create table public.modules (
  code                        text primary key,
  name                        text not null,
  description                 text not null default '',
  version                     text not null default '1.0',
  is_beta                     boolean not null default false,
  is_core                     boolean not null default false,       -- employee_core cannot be switched off
  default_enabled             boolean not null default false,
  addon_price_per_seat_paise  integer not null default 0 check (addon_price_per_seat_paise >= 0),
  depends_on                  text[] not null default '{}',
  sort_order                  integer not null default 0
);

create table public.plans (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code in ('starter','growth','enterprise')),
  name                 text not null,
  price_per_seat_paise integer not null check (price_per_seat_paise >= 0),
  max_seats            integer,                               -- null = unlimited
  features             jsonb not null default '{}'::jsonb,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_plans_touch before update on public.plans
  for each row execute function app.touch_updated_at();

create table public.plan_modules (
  plan_id     uuid not null references public.plans(id) on delete cascade,
  module_code text not null references public.modules(code) on delete cascade,
  primary key (plan_id, module_code)
);

-- ---------------------------------------------------------------------------------------------
-- Statutory reference data. Effective-dated so a change (for example the EPFO wage ceiling) is a
-- data publish, not a release. Customers see status 'announced' rules as an impact simulation only.
-- ---------------------------------------------------------------------------------------------
create table public.statutory_rules (
  id             uuid primary key default gen_random_uuid(),
  rule_key       text not null,
  value          jsonb not null,
  effective_from date not null,
  status         text not null check (status in ('in_force','announced')),
  source         text not null,
  note           text,
  verified_on    date,
  published_by   uuid,
  created_at     timestamptz not null default now(),
  unique (rule_key, effective_from, status)
);
create index on public.statutory_rules (rule_key, effective_from desc);

create table public.states (
  code       text primary key check (code ~ '^[A-Z]{2}$'),
  name       text not null,
  is_ut      boolean not null default false
);

create table public.professional_tax_slabs (
  id            uuid primary key default gen_random_uuid(),
  state_code    text not null references public.states(code),
  frequency     text not null check (frequency in ('monthly','half_yearly')),
  gross_from    numeric(12,2) not null,
  gross_to      numeric(12,2),                     -- null = and above
  amount        numeric(10,2) not null check (amount >= 0),
  february_amount numeric(10,2),
  women_exempt_up_to numeric(12,2),
  annual_cap    numeric(10,2) not null default 2500,
  deduction_months integer[],                       -- half-yearly states
  confidence    text not null check (confidence in ('high','medium','low')),
  verified_on   date,
  source        text,
  effective_from date not null default '2000-01-01',
  check (gross_to is null or gross_to >= gross_from)
);
create index on public.professional_tax_slabs (state_code, effective_from);

create table public.lwf_rates (
  id             uuid primary key default gen_random_uuid(),
  state_code     text not null references public.states(code),
  months         integer[] not null,
  employee_share numeric(8,2) not null,
  employer_share numeric(8,2) not null,
  confidence     text not null check (confidence in ('high','medium','low')),
  verified_on    date,
  notes          text,
  effective_from date not null default '2000-01-01'
);
create index on public.lwf_rates (state_code, effective_from);

-- ---------------------------------------------------------------------------------------------
-- Row level security for the catalog
-- ---------------------------------------------------------------------------------------------
alter table public.platform_users            enable row level security;
alter table public.platform_permissions      enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.modules                   enable row level security;
alter table public.plans                     enable row level security;
alter table public.plan_modules              enable row level security;
alter table public.statutory_rules           enable row level security;
alter table public.states                    enable row level security;
alter table public.professional_tax_slabs    enable row level security;
alter table public.lwf_rates                 enable row level security;

-- Platform users: see yourself; super admin manages everyone.
create policy platform_users_select on public.platform_users for select to authenticated
  using (id = app.uid() or app.platform_can('manage_platform_users'));
create policy platform_users_write on public.platform_users for all to authenticated
  using (app.platform_can('manage_platform_users')) with check (app.platform_can('manage_platform_users'));

create policy platform_permissions_select on public.platform_permissions for select to authenticated
  using (app.is_platform_user());
create policy platform_permissions_write on public.platform_permissions for all to authenticated
  using (app.platform_can('manage_platform_users')) with check (app.platform_can('manage_platform_users'));

create policy platform_role_permissions_select on public.platform_role_permissions for select to authenticated
  using (app.is_platform_user());
create policy platform_role_permissions_write on public.platform_role_permissions for all to authenticated
  using (app.platform_can('manage_platform_users')) with check (app.platform_can('manage_platform_users'));

-- Public catalog: any signed-in user can read modules, plans and statutory data (payroll needs them).
create policy modules_select on public.modules for select to authenticated using (true);
create policy modules_write  on public.modules for all to authenticated
  using (app.platform_can('edit_modules')) with check (app.platform_can('edit_modules'));

create policy plans_select on public.plans for select to authenticated using (true);
create policy plans_write  on public.plans for all to authenticated
  using (app.platform_can('manage_licenses')) with check (app.platform_can('manage_licenses'));

create policy plan_modules_select on public.plan_modules for select to authenticated using (true);
create policy plan_modules_write  on public.plan_modules for all to authenticated
  using (app.platform_can('manage_licenses')) with check (app.platform_can('manage_licenses'));

create policy statutory_rules_select on public.statutory_rules for select to authenticated using (true);
create policy statutory_rules_write  on public.statutory_rules for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));

create policy states_select on public.states for select to authenticated using (true);
create policy states_write  on public.states for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));

create policy pt_select on public.professional_tax_slabs for select to authenticated using (true);
create policy pt_write  on public.professional_tax_slabs for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));

create policy lwf_select on public.lwf_rates for select to authenticated using (true);
create policy lwf_write  on public.lwf_rates for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));
