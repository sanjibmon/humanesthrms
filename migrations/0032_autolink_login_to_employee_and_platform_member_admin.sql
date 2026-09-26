-- The employer who is also an employee, and the platform's own member controls.
--
-- THE PROBLEM THIS SOLVES
--
-- A person in this system is two rows that know nothing about each other:
--
--   org_members   the login and the role -- what the employer portal reads
--   employees     the HR record -- what every ESS page reads, because payslips,
--                 leave balances and attendance are all keyed to employee_id
--
-- When a customer account is created, the platform invites an HR or payroll
-- admin. That makes the first row and not the second, which is correct at that
-- moment: the company has no employee records yet. But when that same person is
-- later added to the payroll, a SECOND, unrelated employee row appears, and
-- their membership still has employee_id null. The result is a person who runs
-- payroll for everybody and has no payslip of their own, with no way to fix it
-- from either portal -- Invite would try to create a login for an address that
-- already has one.
--
-- The fix is not a second account. It is a join, made automatically, on the
-- fact that identifies the same human in both rows: the email address.

create or replace function app.autolink_member_employee(p_member uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare m public.org_members%rowtype; v_email text; v_emp uuid;
begin
  select * into m from public.org_members where id = p_member for update;
  if not found or m.employee_id is not null then
    return null;
  end if;

  select lower(email::text) into v_email from auth.users where id = m.user_id;
  if v_email is null then
    return null;
  end if;

  -- Only an employee of the same organisation, only one whose record is not
  -- already claimed by another login, and only an exact address match. A
  -- near-match is a guess, and guessing here would show one person another
  -- person's payslips.
  select e.id into v_emp
    from public.employees e
   where e.org_id = m.org_id
     and lower(e.work_email) = v_email
     and e.status <> 'exited'
     and not exists (
       select 1 from public.org_members o
        where o.org_id = m.org_id and o.employee_id = e.id and o.id <> m.id
     )
   order by e.created_at
   limit 1;

  if v_emp is null then
    return null;
  end if;

  update public.org_members set employee_id = v_emp where id = p_member;
  perform app.log_event(m.org_id, 'people.login_autolinked', 'org_members', p_member::text,
    jsonb_build_object('employee_id', v_emp, 'matched_on', v_email, 'kept_role', m.role));
  return v_emp;
end $$;


-- The other direction: the login already exists and the employee record is
-- created afterwards, which is the order that actually happens -- the HR admin
-- is invited on day one and put on the payroll in week three.
create or replace function app.employees_autolink_login()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_member uuid;
begin
  if new.work_email is null or new.status = 'exited' then
    return null;
  end if;

  select m.id into v_member
    from public.org_members m
    join auth.users u on u.id = m.user_id
   where m.org_id = new.org_id
     and m.employee_id is null
     and m.is_active
     and lower(u.email::text) = lower(new.work_email)
   limit 1;

  if v_member is not null then
    update public.org_members set employee_id = new.id where id = v_member;
    perform app.log_event(new.org_id, 'people.login_autolinked', 'org_members', v_member::text,
      jsonb_build_object('employee_id', new.id, 'matched_on', lower(new.work_email)));
  end if;
  return null;
end $$;

drop trigger if exists employees_autolink_login on public.employees;
create trigger employees_autolink_login
  after insert or update of work_email on public.employees
  for each row execute function app.employees_autolink_login();


-- Provisioning a customer's admin user now looks for their employee record too,
-- for the case where the company was set up before the login was invited.
create or replace function api.provision_org_owner(p_org uuid, p_user uuid, p_role text default 'owner', p_phone text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
        phone     = coalesce(excluded.phone, om.phone)
  returning om.id into v_id;

  perform app.autolink_member_employee(v_id);
  return v_id;
end $$;

revoke all on function api.provision_org_owner(uuid, uuid, text, text) from public;
grant execute on function api.provision_org_owner(uuid, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------- platform side
-- The customer portal got set_member_role in 0028, gated on being a member of
-- that organisation. HumaNest staff are not members of their customers'
-- organisations, so that function can never serve the admin portal. This is the
-- platform's own copy, with the same guards for the same reasons.

create or replace function api.set_org_member_role(p_member uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare m public.org_members%rowtype; owners integer;
begin
  if not app.platform_can('manage_customers') then
    raise exception 'Your account cannot change this organisation''s members' using errcode = '42501';
  end if;

  select * into m from public.org_members where id = p_member for update;
  if not found then
    raise exception 'That member does not exist' using errcode = '23503';
  end if;

  if p_role not in ('owner','hr_admin','payroll_admin','finance_approver',
                    'manager','recruiter','auditor','employee') then
    raise exception 'BAD_ROLE:% is not a role', p_role using errcode = '22023';
  end if;

  if m.role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.org_members
           where org_id = m.org_id and role = 'owner' and is_active) <= 1 then
    raise exception 'LAST_OWNER:This is the only owner. Make somebody else an owner first.'
      using errcode = '42501';
  end if;

  -- The employee role is self service only. Without an employee record behind
  -- it the person would sign in to a portal with nothing in it.
  if p_role = 'employee' and m.employee_id is null then
    raise exception 'NO_EMPLOYEE:Link this login to an employee record before giving it the employee role'
      using errcode = '42501';
  end if;

  if m.role = p_role then
    return jsonb_build_object('status', 'unchanged', 'role', p_role);
  end if;

  update public.org_members set role = p_role where id = p_member;

  perform app.log_event(m.org_id, 'members.role_changed', 'org_members', p_member::text,
    jsonb_build_object('from', m.role, 'to', p_role, 'by', 'platform'));

  return jsonb_build_object('status', 'changed', 'from', m.role, 'to', p_role);
end $$;

revoke all on function api.set_org_member_role(uuid, text) from public;
grant execute on function api.set_org_member_role(uuid, text) to authenticated;


-- Linking by hand, for when the two addresses genuinely differ: somebody signs
-- in as a personal address and is on the payroll under a work one. Passing null
-- unlinks, which takes self service away without touching the employer login.
create or replace function api.set_org_member_employee(p_member uuid, p_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare m public.org_members%rowtype; e public.employees%rowtype;
begin
  if not app.platform_can('manage_customers') then
    raise exception 'Your account cannot change this organisation''s members' using errcode = '42501';
  end if;

  select * into m from public.org_members where id = p_member for update;
  if not found then
    raise exception 'That member does not exist' using errcode = '23503';
  end if;

  if p_employee is null then
    if m.role = 'employee' then
      raise exception 'NO_EMPLOYEE:This login has no role other than employee, so unlinking it would leave an account that can sign in and see nothing. Change the role first.'
        using errcode = '42501';
    end if;
    update public.org_members set employee_id = null where id = p_member;
    perform app.log_event(m.org_id, 'people.login_unlinked', 'org_members', p_member::text,
      jsonb_build_object('was', m.employee_id));
    return jsonb_build_object('status', 'unlinked');
  end if;

  select * into e from public.employees where id = p_employee;
  if not found or e.org_id <> m.org_id then
    raise exception 'That employee is not part of this organisation' using errcode = '23503';
  end if;
  if exists (select 1 from public.org_members o
              where o.org_id = m.org_id and o.employee_id = p_employee and o.id <> p_member) then
    raise exception 'EMPLOYEE_HAS_LOGIN:% already has a different login attached', e.full_name
      using errcode = '23505';
  end if;

  update public.org_members set employee_id = p_employee where id = p_member;
  perform app.log_event(m.org_id, 'people.login_linked', 'org_members', p_member::text,
    jsonb_build_object('employee_id', p_employee, 'kept_role', m.role, 'by', 'platform'));
  return jsonb_build_object('status', 'linked', 'employee', e.full_name);
end $$;

revoke all on function api.set_org_member_employee(uuid, uuid) from public;
grant execute on function api.set_org_member_employee(uuid, uuid) to authenticated;


-- Candidates for that link. Deliberately thin: a name, a code and an address,
-- which is what a picker needs and nothing more. No salary, no PAN, no bank
-- details -- platform staff have no business reading those.
create or replace function api.list_org_employee_choices(p_org uuid)
returns table (id uuid, employee_code text, full_name text, work_email text,
               status text, has_login boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (app.platform_can('manage_customers') or app.platform_can('support_access')) then
    raise exception 'Your account cannot view this organisation''s people' using errcode = '42501';
  end if;

  return query
    select e.id, e.employee_code, e.full_name, e.work_email, e.status,
           exists (select 1 from public.org_members o
                    where o.org_id = e.org_id and o.employee_id = e.id)
      from public.employees e
     where e.org_id = p_org and e.status <> 'exited'
     order by e.full_name;
end $$;

revoke all on function api.list_org_employee_choices(uuid) from public;
grant execute on function api.list_org_employee_choices(uuid) to authenticated;
