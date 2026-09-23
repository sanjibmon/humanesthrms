-- 0015_platform_provisioning_rpcs.sql
-- Lets the admin portal finish a customer onboarding without anyone opening the
-- SQL editor. Three gaps are closed here:
--   * creating an organisation, its licence and its modules as ONE transaction
--   * seeding the first org_members row, which no RLS policy can allow because
--     org_members.members_write requires an existing member of that same org
--   * re-syncing modules when a plan changes, in dependency order
-- All three are security definer and start by asserting the caller is an active
-- platform user with the right permission in an AAL2 session.
--
-- Verified against a simulated authenticated AAL2 session: create -> provision
-- owner -> upgrade -> downgrade (non-core modules outside the new plan switch
-- off) -> delete guard rejects a mismatched name -> delete succeeds.

create or replace function app.assert_platform(perm text)
returns void language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
  if not app.platform_can(perm) then
    raise exception 'Your account does not hold the % permission, or the authenticator step is incomplete', perm
      using errcode = '42501';
  end if;
end $$;

create or replace function api.create_customer(
  p_name text, p_slug text, p_plan text, p_seats integer,
  p_status text default 'trial', p_trial_days integer default 14,
  p_legal_name text default null, p_industry text default null,
  p_pan text default null, p_tan text default null, p_gstin text default null,
  p_billing_cycle text default 'monthly'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_plan public.plans%rowtype;
begin
  perform app.assert_platform('manage_customers');

  if p_status not in ('trial','active') then
    raise exception 'A new customer starts as a trial or active, not %', p_status using errcode = '23514';
  end if;

  select * into v_plan from public.plans where code = p_plan and is_active;
  if not found then
    raise exception 'Unknown or inactive plan %', p_plan using errcode = '23503';
  end if;
  if v_plan.max_seats is not null and p_seats > v_plan.max_seats then
    raise exception 'The % plan allows at most % seats', v_plan.name, v_plan.max_seats using errcode = '23514';
  end if;

  insert into public.organizations
    (name, legal_name, slug, status, industry, pan, tan, gstin,
     trial_started_at, trial_ends_at, created_by)
  values
    (p_name, p_legal_name, p_slug, p_status, p_industry,
     nullif(p_pan,''), nullif(p_tan,''), nullif(p_gstin,''),
     case when p_status = 'trial' then now() end,
     case when p_status = 'trial' then now() + make_interval(days => greatest(1, p_trial_days)) end,
     app.uid())
  returning id into v_org;

  insert into public.organization_licenses (org_id, plan_id, seats_total, billing_cycle, next_billing_at)
  values (v_org, v_plan.id, greatest(1, p_seats), p_billing_cycle,
          case when p_status = 'active' then (current_date + interval '1 month')::date end);

  perform api.sync_org_modules_to_plan(v_org);
  return v_org;
end $$;

create or replace function api.sync_org_modules_to_plan(p_org uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan uuid; r record; n integer := 0;
begin
  perform app.assert_platform('manage_customers');

  select plan_id into v_plan from public.organization_licenses where org_id = p_org;
  if v_plan is null then
    raise exception 'That organisation has no licence yet' using errcode = '23503';
  end if;

  -- Off first, deepest dependents first, never a core module.
  for r in
    select om.module_code from public.organization_modules om
      join public.modules m on m.code = om.module_code
     where om.org_id = p_org and om.enabled and not m.is_core
       and not exists (select 1 from public.plan_modules pm
                        where pm.plan_id = v_plan and pm.module_code = om.module_code)
     order by m.sort_order desc
  loop
    update public.organization_modules set enabled = false
     where org_id = p_org and module_code = r.module_code;
    n := n + 1;
  end loop;

  -- Then on, dependencies first.
  for r in
    select pm.module_code from public.plan_modules pm
      join public.modules m on m.code = pm.module_code
     where pm.plan_id = v_plan order by m.sort_order asc
  loop
    insert into public.organization_modules as om (org_id, module_code, enabled, enabled_by, enabled_at)
    values (p_org, r.module_code, true, app.uid(), now())
    on conflict (org_id, module_code)
      do update set enabled = true, enabled_by = app.uid(), enabled_at = coalesce(om.enabled_at, now());
    n := n + 1;
  end loop;

  return n;
end $$;

create or replace function api.provision_org_owner(p_org uuid, p_user uuid, p_role text default 'owner')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform app.assert_platform('manage_customers');

  if p_role not in ('owner','hr_admin','payroll_admin','finance_approver','manager','recruiter','auditor','employee') then
    raise exception 'Unknown organisation role %', p_role using errcode = '23514';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'That organisation does not exist' using errcode = '23503';
  end if;

  insert into public.org_members (org_id, user_id, role, is_active)
  values (p_org, p_user, p_role, true)
  on conflict (org_id, user_id) do update set role = excluded.role, is_active = true
  returning id into v_id;

  return v_id;
end $$;

create or replace function api.delete_customer(p_org uuid, p_confirm_name text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text; v_invoices integer;
begin
  perform app.assert_platform('manage_customers');

  select name into v_name from public.organizations where id = p_org;
  if v_name is null then
    raise exception 'That organisation does not exist' using errcode = '23503';
  end if;
  if v_name is distinct from p_confirm_name then
    raise exception 'The typed name does not match this organisation' using errcode = '23514';
  end if;

  select count(*) into v_invoices from public.invoices where org_id = p_org;
  if v_invoices > 0 then
    raise exception 'This customer has % invoice(s) and cannot be deleted. Cancel the account instead so the billing history survives.', v_invoices
      using errcode = '23503';
  end if;

  delete from public.organizations where id = p_org;
end $$;

revoke all on function api.create_customer(text,text,text,integer,text,integer,text,text,text,text,text,text) from public;
revoke all on function api.sync_org_modules_to_plan(uuid) from public;
revoke all on function api.provision_org_owner(uuid,uuid,text) from public;
revoke all on function api.delete_customer(uuid,text) from public;

grant execute on function api.create_customer(text,text,text,integer,text,integer,text,text,text,text,text,text) to authenticated;
grant execute on function api.sync_org_modules_to_plan(uuid) to authenticated;
grant execute on function api.provision_org_owner(uuid,uuid,text) to authenticated;
grant execute on function api.delete_customer(uuid,text) to authenticated;
