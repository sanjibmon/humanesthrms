-- 0018_purge_org_member.sql
--
-- Two things this adds.
--
-- 1. api.list_org_members now returns the sign-in email. Without it the portal
--    shows "Invited user" for anyone not yet linked to an employee record —
--    exactly the person an admin is most likely to want to remove. You cannot
--    ask someone to confirm a deletion against a name the screen never showed.
--
-- 2. api.purge_org_member — a hard delete. org_members.user_id carries no
--    foreign key to auth.users, so removing the auth user on its own leaves an
--    orphan membership row behind (that is how smita@brilliantseagull.com ended
--    up a member of an organisation with no account attached). This clears the
--    tenant-side rows and tells the caller whether the auth user should go too.
--
--    security_events is deliberately NOT deleted. It is the security audit
--    trail; the column is nullable precisely so the trail outlives the account.

-- The return type gains a column, and CREATE OR REPLACE cannot change one.
drop function if exists api.list_org_members(uuid);

create function api.list_org_members(p_org uuid)
returns table (id uuid, user_id uuid, role text, is_active boolean,
               employee_id uuid, employee_name text, email text,
               created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.platform_can('manage_customers') or app.platform_can('support_access')) then
    raise exception 'Your account cannot view this organisation''s members' using errcode = '42501';
  end if;

  return query
    select m.id, m.user_id, m.role, m.is_active, m.employee_id, e.full_name,
           u.email::text, m.created_at
      from public.org_members m
      left join public.employees e on e.id = m.employee_id
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
     order by case m.role when 'owner' then 0 else 1 end, m.created_at;
end $$;


create or replace function api.purge_org_member(p_member uuid)
returns table (user_id uuid, purge_auth boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_role text;
  v_org  uuid;
  v_last boolean;
begin
  if not app.platform_can('manage_customers') then
    raise exception 'Your account cannot change this organisation''s members' using errcode = '42501';
  end if;

  select m.user_id, m.role, m.org_id into v_user, v_role, v_org
    from public.org_members m where m.id = p_member;

  if v_user is null then
    raise exception 'That member does not exist' using errcode = '23503';
  end if;

  -- Same rule as deactivation: an organisation that loses its last owner can
  -- never be administered again, and unlike deactivation this cannot be undone.
  if v_role = 'owner'
     and (select count(*) from public.org_members m
           where m.org_id = v_org and m.role = 'owner') <= 1 then
    raise exception 'This is the only owner. Invite a replacement owner first.'
      using errcode = '23514';
  end if;

  -- Only this membership goes. Passing a member id must never reach into an
  -- organisation the caller was not acting on.
  delete from public.org_members m where m.id = p_member;

  -- The rest is keyed to the user rather than the membership, so it is only
  -- safe to clear once they belong to no organisation at all — otherwise they
  -- still need their notifications and trusted devices for the one they remain
  -- in. The same test decides whether the sign-in itself should be destroyed.
  v_last := not exists (select 1 from public.org_members m where m.user_id = v_user);

  if v_last then
    delete from public.notifications   n where n.user_id = v_user;
    delete from public.trusted_devices d where d.user_id = v_user;
    update public.security_events s set user_id = null where s.user_id = v_user;
  end if;

  return query select v_user, v_last;
end $$;

revoke all on function api.purge_org_member(uuid) from public;
grant execute on function api.purge_org_member(uuid) to authenticated;
revoke all on function api.list_org_members(uuid) from public;
grant execute on function api.list_org_members(uuid) to authenticated;
