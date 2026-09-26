-- Restores api.list_org_members, which migration 0028 dropped.
--
-- 0028 replaced it with api.list_org_logins for the customer portal and dropped
-- the old function on the way past. That was wrong: the two functions have the
-- same shape and completely different consumers. list_org_logins is gated on
-- app.can(org, ...) -- a member of that organisation. list_org_members is gated
-- on app.platform_can(...) -- HumaNest staff looking at a customer from the
-- admin portal. Dropping it did not migrate the admin portal onto the new
-- function; it simply took the customer detail page's user list away, so every
-- organisation, trial or paid, showed no users at all including its own admins.
--
-- Both now exist side by side, which is correct: they answer the same question
-- for two different audiences and neither may use the other's permission gate.
--
-- The three timestamps are new. The admin portal wants the same "never
-- activated" signal the customer portal now has -- when staff are asked "they
-- say they never got the email", the answer is in email_confirmed_at.

create or replace function app.list_org_members(p_org uuid)
returns table (id uuid, user_id uuid, role text, is_active boolean,
               employee_id uuid, employee_name text, email text, phone text,
               created_at timestamptz, invited_at timestamptz,
               activated_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (app.platform_can('manage_customers') or app.platform_can('support_access')) then
    raise exception 'Your account cannot view this organisation''s members' using errcode = '42501';
  end if;

  return query
    select m.id, m.user_id, m.role, m.is_active, m.employee_id, e.full_name,
           u.email::text, m.phone, m.created_at,
           u.invited_at, u.email_confirmed_at, u.last_sign_in_at
      from public.org_members m
      left join public.employees e on e.id = m.employee_id
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
     order by case m.role when 'owner' then 0 else 1 end, m.created_at;
end $$;

create or replace function api.list_org_members(p_org uuid)
returns table (id uuid, user_id uuid, role text, is_active boolean,
               employee_id uuid, employee_name text, email text, phone text,
               created_at timestamptz, invited_at timestamptz,
               activated_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$ select * from app.list_org_members(p_org) $$;

revoke all on function api.list_org_members(uuid) from public;
grant execute on function api.list_org_members(uuid) to authenticated;
