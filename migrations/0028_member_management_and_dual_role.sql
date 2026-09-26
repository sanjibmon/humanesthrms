-- Member management, and the two lists an organisation actually has.
--
-- Until now the settings page read org_members directly, which meant it could
-- show a role and nothing else: no email, no sign of whether the person ever
-- activated the account. Those facts live in auth.users, which the customer
-- portal cannot read, so this is an RPC rather than a select. Once it is a
-- function it can also answer the question the portal really wants -- has this
-- person arrived yet? -- which is what makes "resend activation link" a
-- decision rather than a guess.
--
-- The list is deliberately not split here. One row per login, with the role and
-- the employee link both on it; the portal draws two lists from that, because
-- somebody who is both an owner and on the payroll is one login, not two.

drop function if exists api.list_org_members(uuid);

create or replace function app.list_org_logins(p_org uuid)
returns table (
  id uuid, user_id uuid, role text, is_active boolean,
  employee_id uuid, employee_name text, employee_code text, employee_status text,
  email text, phone text,
  created_at timestamptz, invited_at timestamptz, activated_at timestamptz,
  last_sign_in_at timestamptz, is_self boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    m.id,
    m.user_id,
    m.role,
    m.is_active,
    m.employee_id,
    e.full_name,
    e.employee_code,
    e.status,
    u.email::text,
    m.phone,
    m.created_at,
    u.invited_at,
    -- Supabase records the moment the address was confirmed, which for an
    -- invited user is the moment they set a password. Null means the invitation
    -- is still outstanding, which is exactly when a resend is warranted.
    u.email_confirmed_at,
    u.last_sign_in_at,
    (m.user_id = app.uid())
  from public.org_members m
  left join public.employees e on e.id = m.employee_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = p_org
    and (app.can(p_org, 'members.read') or app.can(p_org, 'people.write'))
  order by
    case when m.role = 'owner' then 0 when m.role = 'employee' then 2 else 1 end,
    coalesce(e.full_name, u.email::text)
$$;

create or replace function api.list_org_logins(p_org uuid)
returns table (
  id uuid, user_id uuid, role text, is_active boolean,
  employee_id uuid, employee_name text, employee_code text, employee_status text,
  email text, phone text,
  created_at timestamptz, invited_at timestamptz, activated_at timestamptz,
  last_sign_in_at timestamptz, is_self boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$ select * from app.list_org_logins(p_org) $$;

revoke all on function api.list_org_logins(uuid) from public;
grant execute on function api.list_org_logins(uuid) to authenticated;


-- Changing somebody's role. Gated on members.manage or people.write, which is
-- the owner and HR. Three guards, all in the database so they hold whatever
-- calls them.
create or replace function app.set_member_role(p_member uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  m public.org_members%rowtype;
  owners integer;
begin
  select * into m from public.org_members where id = p_member for update;
  if not found then
    raise exception 'Unknown member' using errcode = 'P0002';
  end if;

  if not (app.can_mfa(m.org_id, 'members.manage') or app.can_mfa(m.org_id, 'people.write')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  if p_role not in ('owner','hr_admin','payroll_admin','finance_approver',
                    'manager','recruiter','auditor','employee') then
    raise exception 'BAD_ROLE:% is not a role', p_role using errcode = '22023';
  end if;

  -- Nobody changes their own role. This is what keeps "HR may change roles"
  -- from meaning "HR may become the owner".
  if m.user_id = app.uid() then
    raise exception 'SELF_ROLE:You cannot change your own role' using errcode = '42501';
  end if;

  -- An organisation without an owner cannot be administered at all.
  if m.role = 'owner' and p_role <> 'owner' then
    select count(*) into owners from public.org_members
     where org_id = m.org_id and role = 'owner' and is_active;
    if owners <= 1 then
      raise exception 'LAST_OWNER:This is the only owner. Make somebody else an owner first.'
        using errcode = '42501';
    end if;
  end if;

  -- The employee role means "this login is only for self service", which is
  -- meaningless without an employee record behind it.
  if p_role = 'employee' and m.employee_id is null then
    raise exception 'NO_EMPLOYEE:Link this login to an employee record before giving it the employee role'
      using errcode = '42501';
  end if;

  if m.role = p_role then
    return jsonb_build_object('status', 'unchanged', 'role', p_role);
  end if;

  update public.org_members set role = p_role where id = p_member;

  perform app.log_event(m.org_id, 'members.role_changed', 'org_members', p_member::text,
    jsonb_build_object('from', m.role, 'to', p_role, 'user_id', m.user_id));

  return jsonb_build_object('status', 'changed', 'from', m.role, 'to', p_role);
end $$;

create or replace function api.set_member_role(p_member uuid, p_role text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.set_member_role(p_member, p_role) $$;

revoke all on function api.set_member_role(uuid, text) from public;
grant execute on function api.set_member_role(uuid, text) to authenticated;


-- Disable and enable, which is what the button now says. Nothing is deleted:
-- the membership, the history and the authenticator all stay, and access stops.
create or replace function app.set_member_enabled(p_member uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  m public.org_members%rowtype;
  owners integer;
begin
  select * into m from public.org_members where id = p_member for update;
  if not found then
    raise exception 'Unknown member' using errcode = 'P0002';
  end if;

  if not (app.can_mfa(m.org_id, 'members.manage') or app.can_mfa(m.org_id, 'people.write')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  if m.user_id = app.uid() and not p_enabled then
    raise exception 'SELF_DISABLE:You cannot disable your own login' using errcode = '42501';
  end if;

  if m.role = 'owner' and not p_enabled then
    select count(*) into owners from public.org_members
     where org_id = m.org_id and role = 'owner' and is_active;
    if owners <= 1 then
      raise exception 'LAST_OWNER:This is the only active owner. Make somebody else an owner first.'
        using errcode = '42501';
    end if;
  end if;

  if m.is_active = p_enabled then
    return jsonb_build_object('status', 'unchanged', 'enabled', p_enabled);
  end if;

  update public.org_members set is_active = p_enabled where id = p_member;

  perform app.log_event(m.org_id,
    case when p_enabled then 'members.enabled' else 'members.disabled' end,
    'org_members', p_member::text,
    jsonb_build_object('user_id', m.user_id, 'role', m.role));

  return jsonb_build_object('status', 'changed', 'enabled', p_enabled);
end $$;

create or replace function api.set_member_enabled(p_member uuid, p_enabled boolean)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.set_member_enabled(p_member, p_enabled) $$;

revoke all on function api.set_member_enabled(uuid, boolean) from public;
grant execute on function api.set_member_enabled(uuid, boolean) to authenticated;


-- What the portal needs before resending an activation email: the address, and
-- whether the person ever finished activating. Never activated means reissue
-- the invitation; already activated means a fresh invitation would be refused,
-- so a set-password link is the right thing instead.
create or replace function app.member_activation_state(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare m public.org_members%rowtype; u record;
begin
  select * into m from public.org_members where id = p_member;
  if not found then
    raise exception 'Unknown member' using errcode = 'P0002';
  end if;
  if not (app.can_mfa(m.org_id, 'members.manage') or app.can_mfa(m.org_id, 'people.write')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select email::text as email, email_confirmed_at, last_sign_in_at
    into u from auth.users where id = m.user_id;

  return jsonb_build_object(
    'user_id', m.user_id,
    'email', u.email,
    'activated', (u.email_confirmed_at is not null),
    'ever_signed_in', (u.last_sign_in_at is not null),
    'role', m.role,
    'is_active', m.is_active
  );
end $$;

create or replace function api.member_activation_state(p_member uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.member_activation_state(p_member) $$;

revoke all on function api.member_activation_state(uuid) from public;
grant execute on function api.member_activation_state(uuid) to authenticated;
