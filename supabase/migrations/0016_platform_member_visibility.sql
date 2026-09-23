-- 0016_platform_member_visibility.sql
-- org_members.members_select is scoped to the organisation's own people, so a
-- HumaNest platform admin cannot see the owner they just provisioned. Rather
-- than widen the policy (which would expose every member row to every platform
-- role), expose a narrow read for staff who already hold customer or support
-- permissions, plus a guarded activate/deactivate.

create or replace function api.list_org_members(p_org uuid)
returns table (id uuid, user_id uuid, role text, is_active boolean,
               employee_id uuid, employee_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.platform_can('manage_customers') or app.platform_can('support_access')) then
    raise exception 'Your account cannot view this organisation''s members' using errcode = '42501';
  end if;

  return query
    select m.id, m.user_id, m.role, m.is_active, m.employee_id, e.full_name, m.created_at
      from public.org_members m
      left join public.employees e on e.id = m.employee_id
     where m.org_id = p_org
     order by case m.role when 'owner' then 0 else 1 end, m.created_at;
end $$;

create or replace function api.set_org_member_active(p_member uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_org uuid;
begin
  if not app.platform_can('manage_customers') then
    raise exception 'Your account cannot change this organisation''s members' using errcode = '42501';
  end if;

  select role, org_id into v_role, v_org from public.org_members where id = p_member;
  if v_org is null then
    raise exception 'That member does not exist' using errcode = '23503';
  end if;

  -- An organisation must keep at least one active owner, or nobody can administer it.
  if v_role = 'owner' and not p_active
     and (select count(*) from public.org_members
           where org_id = v_org and role = 'owner' and is_active) <= 1 then
    raise exception 'This is the only active owner. Make someone else an owner first.'
      using errcode = '23514';
  end if;

  update public.org_members set is_active = p_active where id = p_member;
end $$;

revoke all on function api.list_org_members(uuid) from public;
revoke all on function api.set_org_member_active(uuid, boolean) from public;
grant execute on function api.list_org_members(uuid) to authenticated;
grant execute on function api.set_org_member_active(uuid, boolean) to authenticated;
