-- 0019_contact_numbers.sql
--
-- A contact number becomes mandatory for the two kinds of people who administer
-- something: HumaNest's own staff, and the admin user of a customer account.
--
-- Four decisions worth recording.
--
-- 1. The number lives on the *person*, not on the organisation. An account's
--    admin can change without the company's billing details changing, and the
--    number that matters is the one reaching the human who can unlock a payroll
--    run at 9pm on the 30th.
--
-- 2. Stored in E.164 (`+919876543210`) so it is unambiguous, comparable and
--    ready for an SMS gateway or WhatsApp without further parsing. Input runs
--    through app.normalize_phone, which accepts the shapes an Indian user
--    actually types — `9876543210`, `098765 43210`, `+91 98765-43210`.
--
-- 3. Enforced on INSERT by a trigger rather than by NOT NULL. A NOT NULL, or a
--    NOT VALID check, is evaluated on every UPDATE too, so rows created before
--    this column existed would have started rejecting unrelated updates such as
--    deactivation or a last-login stamp. The trigger makes the rule bite on
--    everything new, a second guard stops an existing number being cleared, and
--    once no rows are missing one a follow-up migration can promote this to a
--    plain NOT NULL.
--
-- 4. Ordinary employee members are exempt. Their numbers belong on
--    employees.work_phone and employee_personal.personal_phone, which are part
--    of the HR record proper; requiring it on org_members too would block
--    employee self-service provisioning later for no benefit.

/* ---------------------------------------------------------------- helpers */

create or replace function app.normalize_phone(p_raw text)
returns text
language plpgsql immutable set search_path = pg_temp as $$
declare v text; had_plus boolean;
begin
  if p_raw is null then return null; end if;

  had_plus := left(btrim(p_raw), 1) = '+';
  v := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if v = '' then return null; end if;

  -- An explicit country code is taken at face value.
  if had_plus then return '+' || v; end if;

  -- Otherwise assume India, allowing the trunk prefix and a bare 91.
  v := regexp_replace(v, '^0+', '');
  if v ~ '^91[6-9][0-9]{9}$' then return '+' || v; end if;
  if v ~ '^[6-9][0-9]{9}$'   then return '+91' || v; end if;

  return '+' || v;   -- leave anything else for the CHECK to reject
end $$;

comment on function app.normalize_phone(text) is
  'Turns what a user types into E.164. Assumes +91 for a bare 10-digit Indian mobile.';


/* A number is required when the row is created, and may never be cleared once
   set. TG_ARGV[0] optionally names the column holding a role, in which case the
   requirement applies only to the administrator roles. */
create or replace function app.require_phone()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_role text; v_admin boolean;
begin
  new.phone := app.normalize_phone(new.phone);

  if tg_nargs > 0 then
    v_role := to_jsonb(new) ->> tg_argv[0];
    v_admin := v_role in ('owner', 'hr_admin', 'payroll_admin');
  else
    v_admin := true;
  end if;

  if tg_op = 'INSERT' then
    if new.phone is null and v_admin then
      raise exception 'A contact number is required%.',
        case when tg_nargs > 0 then ' for an administrator' else '' end
        using errcode = '23502';
    end if;
  elsif old.phone is not null and new.phone is null then
    raise exception 'A contact number is required and cannot be removed.'
      using errcode = '23502';
  end if;

  return new;
end $$;


/* ------------------------------------------------------- platform_users */

alter table public.platform_users add column if not exists phone text;

alter table public.platform_users drop constraint if exists platform_users_phone_check;
alter table public.platform_users add constraint platform_users_phone_check
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

drop trigger if exists platform_users_require_phone on public.platform_users;
create trigger platform_users_require_phone
  before insert or update on public.platform_users
  for each row execute function app.require_phone();


/* ----------------------------------------------------------- org_members */

alter table public.org_members add column if not exists phone text;

alter table public.org_members drop constraint if exists org_members_phone_check;
alter table public.org_members add constraint org_members_phone_check
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

drop trigger if exists org_members_require_phone on public.org_members;
create trigger org_members_require_phone
  before insert or update on public.org_members
  for each row execute function app.require_phone('role');


/* ------------------------------------------------------------------ rpcs */

-- The three-argument form has to go, or a three-argument call becomes
-- ambiguous against the new default.
drop function if exists api.provision_org_owner(uuid, uuid, text);

create function api.provision_org_owner(
  p_org uuid, p_user uuid, p_role text default 'owner', p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_phone text;
begin
  perform app.assert_platform('manage_customers');

  if p_role not in ('owner','hr_admin','payroll_admin','finance_approver','manager',
                    'recruiter','auditor','employee') then
    raise exception 'Unknown organisation role %', p_role using errcode = '23514';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'That organisation does not exist' using errcode = '23503';
  end if;

  v_phone := app.normalize_phone(p_phone);
  if v_phone is null and p_role in ('owner','hr_admin','payroll_admin') then
    raise exception 'A contact number is required for an administrator.'
      using errcode = '23502';
  end if;

  insert into public.org_members as om (org_id, user_id, role, is_active, phone)
  values (p_org, p_user, p_role, true, v_phone)
  on conflict (org_id, user_id) do update
    set role      = excluded.role,
        is_active = true,
        -- Re-inviting without a number must not wipe the one already on file.
        phone     = coalesce(excluded.phone, om.phone)
  returning om.id into v_id;

  return v_id;
end $$;


-- The list gains the number, and there is now a way to correct it. A mandatory
-- field with no edit path is a trap: one typo and nobody can reach that
-- customer again.
drop function if exists api.list_org_members(uuid);

create function api.list_org_members(p_org uuid)
returns table (id uuid, user_id uuid, role text, is_active boolean,
               employee_id uuid, employee_name text, email text, phone text,
               created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.platform_can('manage_customers') or app.platform_can('support_access')) then
    raise exception 'Your account cannot view this organisation''s members' using errcode = '42501';
  end if;

  return query
    select m.id, m.user_id, m.role, m.is_active, m.employee_id, e.full_name,
           u.email::text, m.phone, m.created_at
      from public.org_members m
      left join public.employees e on e.id = m.employee_id
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
     order by case m.role when 'owner' then 0 else 1 end, m.created_at;
end $$;


create or replace function api.set_org_member_phone(p_member uuid, p_phone text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text;
begin
  if not app.platform_can('manage_customers') then
    raise exception 'Your account cannot change this organisation''s members' using errcode = '42501';
  end if;

  v_phone := app.normalize_phone(p_phone);
  if v_phone is null then
    raise exception 'A contact number is required.'
      using errcode = '23502';
  end if;

  update public.org_members set phone = v_phone where id = p_member;
  if not found then
    raise exception 'That member does not exist' using errcode = '23503';
  end if;

  return v_phone;
end $$;

revoke all on function api.set_org_member_phone(uuid, text) from public;
grant execute on function api.set_org_member_phone(uuid, text) to authenticated;
revoke all on function api.list_org_members(uuid) from public;
grant execute on function api.list_org_members(uuid) to authenticated;
revoke all on function api.provision_org_owner(uuid, uuid, text, text) from public;
grant execute on function api.provision_org_owner(uuid, uuid, text, text) to authenticated;
