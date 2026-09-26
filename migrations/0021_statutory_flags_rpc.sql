-- 0021_statutory_flags_rpc.sql
--
-- employee_statutory carries no table grants for `authenticated` on purpose: the
-- only way in is a security-definer function, so the encryption in
-- app.save_statutory cannot be bypassed by writing the columns directly.
--
-- But the payroll applicability flags and the tax regime live on the same table
-- and hold no secret, and until now there was no way to set them at all — the
-- portal could capture a PAN and then had no route to say whether PF applies.
-- This is the missing half, guarded by exactly the same permission.

create or replace function app.set_statutory_flags(
  emp uuid,
  p_tax_regime text default null,
  p_pf boolean default null,
  p_pf_on_actual boolean default null,
  p_esi boolean default null,
  p_pt boolean default null,
  p_lwf boolean default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid;
begin
  select e.org_id into org from public.employees e where e.id = emp;
  if org is null or not app.can_mfa(org, 'people.sensitive.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_tax_regime is not null and p_tax_regime not in ('new','old') then
    raise exception 'Tax regime must be new or old' using errcode = '23514';
  end if;

  insert into public.employee_statutory (employee_id, org_id) values (emp, org)
  on conflict (employee_id) do nothing;

  update public.employee_statutory set
    tax_regime     = coalesce(p_tax_regime, tax_regime),
    pf_applicable  = coalesce(p_pf, pf_applicable),
    pf_on_actual   = coalesce(p_pf_on_actual, pf_on_actual),
    esi_applicable = coalesce(p_esi, esi_applicable),
    pt_applicable  = coalesce(p_pt, pt_applicable),
    lwf_applicable = coalesce(p_lwf, lwf_applicable),
    updated_at     = now()
  where employee_id = emp;

  perform app.log_event(org, 'statutory.flags', 'employee_statutory', emp::text,
    jsonb_build_object('tax_regime', p_tax_regime, 'pf', p_pf, 'esi', p_esi,
                       'pt', p_pt, 'lwf', p_lwf));
end $$;

create or replace function api.set_statutory_flags(
  emp uuid,
  p_tax_regime text default null,
  p_pf boolean default null,
  p_pf_on_actual boolean default null,
  p_esi boolean default null,
  p_pt boolean default null,
  p_lwf boolean default null)
returns void
language sql security invoker set search_path = public, pg_temp as $$
  select app.set_statutory_flags(emp, p_tax_regime, p_pf, p_pf_on_actual, p_esi, p_pt, p_lwf);
$$;

revoke all on function api.set_statutory_flags(uuid, text, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function api.set_statutory_flags(uuid, text, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- NOTE: app.pii_key() reads the Supabase Vault secret `pii_master_key`. It is
-- created once per project, outside migrations, and must never be regenerated
-- while encrypted PAN or bank values exist:
--
--   select vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),
--                              'pii_master_key', 'AES-256 key for employee PII');
