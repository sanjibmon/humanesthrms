-- 0013_pdf_catalog_alignment.sql
-- Brings the shipped catalog in line with the two product prompts:
--   * adds the Trial plan alongside starter / growth / enterprise
--   * adds the 7 modules the prompts require that the base schema did not carry
--   * adds platform_support_tickets for the admin portal's Support module
--   * adds the trial lifecycle columns the admin portal reports on
-- Applied to project acxitxszyhmqskswetej.

alter table public.plans drop constraint if exists plans_code_check;
alter table public.plans add constraint plans_code_check
  check (code in ('starter','growth','enterprise','trial'));

insert into public.plans (code, name, price_per_seat_paise, max_seats, features) values
  ('trial', 'Trial', 0, 50, '{"support":"email","free":true,"durations_days":[7,14,30]}')
on conflict (code) do nothing;

insert into public.modules (code, name, description, version, is_beta, is_core, default_enabled, addon_price_per_seat_paise, depends_on, sort_order) values
  ('ess',          'Employee Self Service', 'Employee portal for profile, attendance, leave and payslips.',       '1.0.0', false, true,  true,  0, '{}',            14),
  ('shift_roster', 'Shift & Roster',        'Shift patterns, rosters, week offs and overtime eligibility.',       '1.0.0', false, false, false, 0, '{attendance}',  15),
  ('documents',    'Document',              'Policy library, employee documents and acknowledgement tracking.',   '1.0.0', false, false, true,  0, '{}',            16),
  ('reports',      'Reports',               'Cross module reporting with scheduled delivery and exports.',        '1.0.0', false, false, true,  0, '{}',            17),
  ('lms',          'LMS',                   'Courses, learning paths, assessments and completion certificates.',  '0.9.0', true,  false, false, 0, '{}',            18),
  ('integrations', 'Integrations',          'Biometric devices, accounting, SSO and webhooks.',                   '1.0.0', false, false, false, 0, '{}',            19),
  ('security',     'Security',              'MFA policy, session control, IP allow lists and the audit trail.',   '1.0.0', false, true,  true,  0, '{}',            20)
on conflict (code) do nothing;

alter table public.organizations
  add column if not exists trial_started_at      timestamptz,
  add column if not exists trial_extended_count  integer not null default 0,
  add column if not exists converted_at          timestamptz,
  add column if not exists non_conversion_reason text;

create table if not exists public.platform_support_tickets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations(id) on delete set null,
  subject       text not null,
  body          text,
  category      text not null default 'general',
  priority      text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status        text not null default 'open'   check (status in ('open','pending','resolved','closed')),
  raised_by     uuid,
  assigned_to   uuid references public.platform_users(id) on delete set null,
  first_response_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_pst_status on public.platform_support_tickets(status, created_at desc);
create index if not exists idx_pst_org    on public.platform_support_tickets(org_id);

create or replace function app.pst_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  new.updated_at := now();
  if new.status in ('resolved','closed') and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_pst_before on public.platform_support_tickets;
create trigger trg_pst_before before insert or update on public.platform_support_tickets
  for each row execute function app.pst_before();

alter table public.platform_support_tickets enable row level security;

drop policy if exists pst_platform_read  on public.platform_support_tickets;
drop policy if exists pst_platform_write on public.platform_support_tickets;

create policy pst_platform_read on public.platform_support_tickets
  for select to authenticated
  using (exists (select 1 from public.platform_users pu where pu.id = auth.uid() and pu.is_active));

create policy pst_platform_write on public.platform_support_tickets
  for all to authenticated
  using (exists (select 1 from public.platform_users pu where pu.id = auth.uid() and pu.is_active and pu.role in ('super_admin','support')))
  with check (exists (select 1 from public.platform_users pu where pu.id = auth.uid() and pu.is_active and pu.role in ('super_admin','support')));
