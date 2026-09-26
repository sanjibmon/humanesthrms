-- A contact number the customer portal can actually set.
--
-- api.set_org_member_phone already existed, but it is gated on
-- app.platform_can('manage_customers') -- it is for HumaNest staff working on
-- a customer from the admin portal. The customer's own HR admin had no way to
-- set a phone at all, which, combined with 0029 requiring one before an
-- administrator role, meant HR could never promote anybody: the promotion
-- demanded a number that HR had no function to write. This closes that.

create or replace function app.set_member_phone(p_member uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  m public.org_members%rowtype;
  v_phone text;
begin
  select * into m from public.org_members where id = p_member for update;
  if not found then
    raise exception 'Unknown member' using errcode = 'P0002';
  end if;

  if not (app.can_mfa(m.org_id, 'members.manage') or app.can_mfa(m.org_id, 'people.write')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  v_phone := app.normalize_phone(p_phone);
  if v_phone is null then
    raise exception 'BAD_PHONE:Enter the number in international form, for example +919876543210'
      using errcode = '23502';
  end if;

  update public.org_members set phone = v_phone where id = p_member;

  perform app.log_event(m.org_id, 'members.phone_set', 'org_members', p_member::text,
    jsonb_build_object('user_id', m.user_id));

  return jsonb_build_object('phone', v_phone);
end $$;

create or replace function api.set_member_phone(p_member uuid, p_phone text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.set_member_phone(p_member, p_phone) $$;

revoke all on function api.set_member_phone(uuid, text) from public;
grant execute on function api.set_member_phone(uuid, text) to authenticated;
