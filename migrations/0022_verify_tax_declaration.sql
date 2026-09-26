-- Verifying a tax declaration has to do two things in one breath: close the
-- declaration, and make payroll actually tax the person under the regime they
-- asked for. Those live in different tables with different owners --
-- tax_declarations is payroll's, employee_statutory.tax_regime sits behind
-- people.sensitive.write, which belongs to HR. Left as two separate actions,
-- payroll verifies a declaration and the regime silently stays wrong, which is
-- the worst possible outcome: a correct-looking screen and an incorrect payslip.
--
-- So this function carries the narrow authority instead. It is not a general
-- "set anybody's regime" power: it can only copy the regime off a declaration
-- the employee themselves submitted, and only while closing that declaration.

create or replace function app.verify_tax_declaration(p_decl uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  d public.tax_declarations%rowtype;
  n integer;
begin
  select * into d from public.tax_declarations where id = p_decl for update;
  if not found then
    raise exception 'Unknown declaration' using errcode = 'P0002';
  end if;
  if not app.can_mfa(d.org_id, 'payroll.run') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if d.status = 'locked' then
    raise exception 'That year is locked; Form 16 has already been issued on it' using errcode = '42501';
  end if;
  if d.status = 'draft' then
    raise exception 'The employee has not submitted this declaration yet' using errcode = '42501';
  end if;

  select count(*) into n from public.tax_declaration_items
   where declaration_id = p_decl and status = 'pending';
  if n > 0 then
    raise exception 'DECIDE_ITEMS:% item(s) still have no decision', n using errcode = '42501';
  end if;

  update public.tax_declarations
     set status = 'verified', verified_by = app.uid(), verified_at = now()
   where id = p_decl;

  -- The row may not exist yet if no identifiers have been captured.
  insert into public.employee_statutory (employee_id, org_id)
  values (d.employee_id, d.org_id)
  on conflict (employee_id) do nothing;

  update public.employee_statutory
     set tax_regime = d.regime, updated_at = now()
   where employee_id = d.employee_id;

  perform app.log_event(d.org_id, 'tax.declaration.verified', 'tax_declarations', p_decl::text,
    jsonb_build_object('employee_id', d.employee_id, 'fy_start', d.fy_start, 'regime', d.regime));

  return d.regime;
end $$;

create or replace function api.verify_tax_declaration(p_decl uuid)
returns text
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.verify_tax_declaration(p_decl) $$;

revoke all on function api.verify_tax_declaration(uuid) from public;
grant execute on function api.verify_tax_declaration(uuid) to authenticated;
