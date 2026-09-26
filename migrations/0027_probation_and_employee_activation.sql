-- Probation, and giving an employee a login.
--
-- Two gaps this closes.
--
-- 1. There was no way at all to get an employee into self service. The customer
--    portal could change an existing member's role and switch them off, but it
--    could not create one, and nothing invited anybody. So HR added an employee
--    and the employee had no account, no email and no way in.
--    api.link_employee_login is the missing half: the server action creates the
--    auth user through the Auth admin API, then calls this to attach it to the
--    employee record.
--
--    It is deliberately NOT gated on members.manage. That permission can hand
--    out any role including owner, and belongs to the owner alone. Inviting an
--    employee to see their own payslip is a much smaller power, so it sits
--    behind people.write -- which HR already has -- and the function forces the
--    role to 'employee'. It cannot be used to escalate anybody, and when the
--    user is already a member in some other capacity it attaches the employee
--    record to that membership without touching their role, so an owner who is
--    also on the payroll can never be quietly demoted.
--
-- 2. Probation. India's default is six months, so 180 days is the default here,
--    but it is settable per organisation and per employee, and it is always in
--    days -- never months -- because "six months from the 31st of August" is an
--    argument nobody needs to have.

/* ─────────────────────────────── probation ─────────────────────────────── */

alter table public.employees drop constraint if exists employees_employment_type_check;
alter table public.employees add constraint employees_employment_type_check
  check (employment_type = any (array[
    'permanent', 'probation', 'fixed_term', 'contract', 'intern', 'consultant'
  ]));

alter table public.employees
  add column if not exists probation_days integer,
  add column if not exists probation_confirmed_on date;

-- A probation end date that cannot drift from the joining date it is derived
-- from. Stored so it can be indexed and queried, generated so nothing can set
-- it to a date that disagrees with doj + probation_days.
alter table public.employees
  add column if not exists probation_end_date date
  generated always as (
    case when employment_type = 'probation' and probation_days is not null
         then doj + probation_days
    end
  ) stored;

alter table public.employees drop constraint if exists employees_probation_days_check;
alter table public.employees add constraint employees_probation_days_check
  check (
    employment_type <> 'probation'
    or (probation_days is not null and probation_days between 1 and 730)
  );

create index if not exists employees_probation_due_idx
  on public.employees (org_id, probation_end_date)
  where employment_type = 'probation';

alter table public.org_settings
  add column if not exists default_probation_days integer not null default 180;

alter table public.org_settings drop constraint if exists org_settings_probation_days_check;
alter table public.org_settings add constraint org_settings_probation_days_check
  check (default_probation_days between 1 and 730);


/* ───────────────────────────── email outbox ─────────────────────────────
   There is no transactional mail provider wired to this project yet -- the
   Resend setup covers Supabase Auth's own emails (invitations, password
   resets), not application mail. Rather than pretend to send, or drop the
   message and leave the employee uninformed, every application email is
   written here and marked pending. A sender picks them up when one exists, and
   nothing is lost in the meantime. The in-app notification goes out either way,
   so the employee is told inside the product immediately. */

create table if not exists public.email_outbox (
  id          uuid primary key default extensions.uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid,
  to_email    text not null,
  to_name     text,
  template    text not null,
  subject     text not null,
  body        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
                check (status in ('pending', 'sent', 'failed', 'cancelled')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists email_outbox_pending_idx
  on public.email_outbox (created_at) where status = 'pending';

alter table public.email_outbox enable row level security;

drop policy if exists outbox_select on public.email_outbox;
create policy outbox_select on public.email_outbox for select
  using (app.can(org_id, 'settings.read') or app.can(org_id, 'people.write'));

-- No write policy on purpose: rows are only ever written by the security-definer
-- functions below, so an application email can never be forged from the client.


/* ──────────────────── confirm probation when it is due ────────────────────
   Date-driven and idempotent. It reads only what is already in the database, so
   running it twice, or late, or from two places at once, confirms nobody twice
   -- the employment_type filter stops the second pass seeing them at all.

   There is no pg_cron in this project, so the customer portal calls this when
   the Employees page loads. That is not as tidy as a scheduled job, but it is
   self-healing: the confirmation lands the first time anybody in HR opens the
   page on or after the due date, and the recorded effective date is the real
   due date rather than the day somebody noticed. A scheduled edge function can
   replace the trigger later without changing this function. */

create or replace function app.confirm_due_probations(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  e record;
  n integer := 0;
  names text[] := '{}';
  org_name text;
begin
  if not app.can_mfa(p_org, 'people.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select name into org_name from public.organizations where id = p_org;

  for e in
    select id, full_name, employee_code, work_email, doj, probation_days, probation_end_date
      from public.employees
     where org_id = p_org
       and employment_type = 'probation'
       and probation_end_date is not null
       and probation_end_date <= current_date
       and status in ('active', 'on_notice')
     order by probation_end_date
  loop
    update public.employees
       set employment_type = 'permanent',
           probation_confirmed_on = e.probation_end_date,
           updated_at = now()
     where id = e.id;

    insert into public.employee_history
      (org_id, employee_id, effective_from, change_type, from_value, to_value, reason, created_by)
    values (p_org, e.id, e.probation_end_date, 'confirmation',
            jsonb_build_object('employment_type', 'probation', 'probation_days', e.probation_days),
            jsonb_build_object('employment_type', 'permanent'),
            'Probation of ' || e.probation_days || ' days completed on ' || e.probation_end_date,
            app.uid());

    -- Tell them in the product straight away, if they have a login.
    insert into public.notifications (org_id, user_id, kind, title, body, link)
    select p_org, m.user_id, 'confirmation',
           'Your probation is complete',
           'You are now a permanent employee of ' || coalesce(org_name, 'the company')
             || ', effective ' || to_char(e.probation_end_date, 'DD Mon YYYY') || '.',
           '/me/profile'
      from public.org_members m
     where m.employee_id = e.id and m.org_id = p_org and m.is_active;

    -- And queue the email, so it goes out once a sender exists.
    if e.work_email is not null then
      insert into public.email_outbox
        (org_id, employee_id, to_email, to_name, template, subject, body, payload)
      values (
        p_org, e.id, e.work_email, e.full_name, 'probation_confirmed',
        'Your probation is complete — you are now permanent',
        'Dear ' || e.full_name || E',\n\n'
          || 'Your probation period of ' || e.probation_days || ' days ended on '
          || to_char(e.probation_end_date, 'DD Mon YYYY') || '. Your employment with '
          || coalesce(org_name, 'us') || ' is now confirmed as permanent.' || E'\n\n'
          || 'Nothing changes in how you use the portal. Your leave entitlement and '
          || 'any benefits that were held during probation now apply in full.' || E'\n\n'
          || 'Regards' || E'\n' || coalesce(org_name, 'Human Resources'),
        jsonb_build_object('employee_code', e.employee_code,
                           'confirmed_on', e.probation_end_date,
                           'probation_days', e.probation_days)
      );
    end if;

    names := names || (e.full_name || ' (' || e.employee_code || ')');
    n := n + 1;
  end loop;

  if n > 0 then
    perform app.log_event(p_org, 'people.probation_confirmed', 'employees', null,
      jsonb_build_object('count', n, 'employees', to_jsonb(names)));
  end if;

  return jsonb_build_object('confirmed', n, 'names', to_jsonb(names));
end $$;

create or replace function api.confirm_due_probations(p_org uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.confirm_due_probations(p_org) $$;

revoke all on function api.confirm_due_probations(uuid) from public;
grant execute on function api.confirm_due_probations(uuid) to authenticated;


/* ───────────────── attach a login to an employee record ───────────────── */

create or replace function app.link_employee_login(p_employee uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  e public.employees%rowtype;
  existing public.org_members%rowtype;
begin
  select * into e from public.employees where id = p_employee;
  if not found then
    raise exception 'Unknown employee' using errcode = 'P0002';
  end if;
  if not app.can_mfa(e.org_id, 'people.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  -- Already linked to this same person: nothing to do, and say so rather than
  -- failing, so a resend is harmless.
  select * into existing from public.org_members
   where org_id = e.org_id and employee_id = p_employee;
  if found then
    if existing.user_id = p_user then
      return jsonb_build_object('status', 'already_linked', 'member_id', existing.id);
    end if;
    raise exception 'EMPLOYEE_HAS_LOGIN:% already has a different login attached', e.full_name
      using errcode = '23505';
  end if;

  -- The user may already be a member in another capacity -- an owner who is
  -- also on the payroll, say. Attach the employee record to that membership
  -- rather than creating a second one, and never touch their role.
  select * into existing from public.org_members
   where org_id = e.org_id and user_id = p_user;
  if found then
    update public.org_members
       set employee_id = p_employee, is_active = true
     where id = existing.id;
    perform app.log_event(e.org_id, 'people.login_linked', 'org_members', existing.id::text,
      jsonb_build_object('employee_id', p_employee, 'kept_role', existing.role));
    return jsonb_build_object('status', 'attached_to_existing',
                              'member_id', existing.id, 'role', existing.role);
  end if;

  insert into public.org_members (org_id, user_id, role, employee_id, is_active)
  values (e.org_id, p_user, 'employee', p_employee, true)
  returning * into existing;

  perform app.log_event(e.org_id, 'people.login_linked', 'org_members', existing.id::text,
    jsonb_build_object('employee_id', p_employee, 'role', 'employee'));

  return jsonb_build_object('status', 'created', 'member_id', existing.id, 'role', 'employee');
end $$;

create or replace function api.link_employee_login(p_employee uuid, p_user uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.link_employee_login(p_employee, p_user) $$;

revoke all on function api.link_employee_login(uuid, uuid) from public;
grant execute on function api.link_employee_login(uuid, uuid) to authenticated;


/* ───────────── a welcome email for the employee, queued ───────────── */

create or replace function app.queue_employee_welcome(p_employee uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare e public.employees%rowtype; org_name text;
begin
  select * into e from public.employees where id = p_employee;
  if not found or e.work_email is null then return; end if;
  if not app.can_mfa(e.org_id, 'people.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select name into org_name from public.organizations where id = e.org_id;

  insert into public.email_outbox
    (org_id, employee_id, to_email, to_name, template, subject, body, payload)
  values (
    e.org_id, e.id, e.work_email, e.full_name, 'employee_welcome',
    'Welcome to ' || coalesce(org_name, 'the team'),
    'Dear ' || e.full_name || E',\n\n'
      || 'Welcome to ' || coalesce(org_name, 'the company')
      || '. Your employee record has been created'
      || case when e.employee_code is not null then ' with the code ' || e.employee_code else '' end
      || '.' || E'\n\n'
      || 'You will receive a separate email asking you to activate your account and set a '
      || 'password. Once you have, you can see your payslips, apply for leave, mark '
      || 'attendance and keep your own details up to date.' || E'\n\n'
      || 'Regards' || E'\n' || coalesce(org_name, 'Human Resources'),
    jsonb_build_object('employee_code', e.employee_code, 'doj', e.doj,
                       'employment_type', e.employment_type)
  );
end $$;

create or replace function api.queue_employee_welcome(p_employee uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.queue_employee_welcome(p_employee) $$;

revoke all on function api.queue_employee_welcome(uuid) from public;
grant execute on function api.queue_employee_welcome(uuid) to authenticated;
