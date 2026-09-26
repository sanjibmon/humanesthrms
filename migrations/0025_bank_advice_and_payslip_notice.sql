-- Paying people, and telling them they have been paid.
--
-- 1. app.bank_advice decrypts bank accounts for one pay run so a NEFT file can
--    be produced. It is the single most sensitive read in the product, so it is
--    gated harder than anything else: the caller needs payroll.pay AND
--    pii.reveal AND a second factor, the run has to be locked or paid, and the
--    whole call writes one audit row naming the run and the number of accounts
--    read. Held items and zero nets are excluded -- a held payslip is
--    deliberately not paid.
--
--    Doing it in one function rather than one reveal per employee is not only
--    faster: it turns a hundred scattered audit rows into a single, legible
--    "somebody produced the bank file for August" that an auditor can actually
--    reason about.
--
--    Note that payroll.pay and pii.reveal sit on different roles in the seeded
--    defaults -- finance_approver pays, payroll_admin can reveal. That is not an
--    oversight to work around: a small organisation grants one person both and
--    accepts it, a larger one keeps them apart so no single person can produce a
--    file of every employee's bank account and move money with it.
--
-- 2. publish_payslips now also drops a notification for each employee whose
--    login is linked. Publishing a payslip that nobody is told about is how
--    payroll teams end up answering the same question forty times.

create or replace function app.bank_advice(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r public.pay_runs%rowtype;
  ent public.legal_entities%rowtype;
  key text;
  rows jsonb;
  n integer;
begin
  select * into r from public.pay_runs where id = p_run;
  if not found then
    raise exception 'Unknown pay run' using errcode = 'P0002';
  end if;
  if not app.can_mfa(r.org_id, 'payroll.pay') then
    raise exception 'Not permitted: releasing money needs the payroll.pay permission' using errcode = '42501';
  end if;
  if not app.can(r.org_id, 'pii.reveal') then
    raise exception 'Not permitted: a bank file needs permission to reveal account numbers' using errcode = '42501';
  end if;
  if r.status not in ('locked', 'paid') then
    raise exception 'A bank file can only be produced from a locked run. Lock it first.' using errcode = '42501';
  end if;

  select * into ent from public.legal_entities
   where org_id = r.org_id and (r.entity_id is null or id = r.entity_id)
   order by (id = r.entity_id) desc, is_default desc limit 1;

  key := app.pii_key();

  select coalesce(jsonb_agg(x order by x->>'code'), '[]'::jsonb), count(*) into rows, n from (
    select jsonb_build_object(
      'employeeId', e.id,
      'code',       e.employee_code,
      'name',       e.full_name,
      'net',        i.net,
      'account',    case when s.bank_account_enc is not null
                         then extensions.pgp_sym_decrypt(s.bank_account_enc, key) else null end,
      'ifsc',       s.ifsc,
      'bankName',   s.bank_name,
      'accountLast4', s.bank_last4
    ) as x
    from public.pay_run_items i
    join public.employees e on e.id = i.employee_id
    left join public.employee_statutory s on s.employee_id = e.id
    where i.run_id = p_run and not i.hold and i.net > 0
  ) y;

  perform app.log_event(r.org_id, 'payroll.bank_advice', 'pay_run', p_run::text,
    jsonb_build_object('period', r.period_month, 'accounts', n));

  return jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'month', r.period_month, 'status', r.status),
    'entity', case when ent.id is null then null
                   else jsonb_build_object('name', ent.name, 'pan', ent.pan) end,
    'org', (select name from public.organizations where id = r.org_id),
    'rows', rows
  );
end $$;

create or replace function api.bank_advice(p_run uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.bank_advice(p_run) $$;

revoke all on function api.bank_advice(uuid) from public;
grant execute on function api.bank_advice(uuid) to authenticated;


create or replace function app.publish_payslips(p_run uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare r public.pay_runs%rowtype; n integer;
begin
  select * into r from public.pay_runs where id = p_run;
  if not found or not app.can_mfa(r.org_id, 'payroll.run') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if r.status not in ('locked','paid') then
    raise exception 'Payslips can be published only after the run is locked';
  end if;

  insert into public.payslips (org_id, employee_id, run_id, period_month, published_by)
  select i.org_id, i.employee_id, i.run_id, r.period_month, app.uid()
    from public.pay_run_items i
   where i.run_id = p_run and not i.hold
  on conflict (run_id, employee_id) do nothing;
  get diagnostics n = row_count;

  -- Tell the people whose payslip it is. Only employees with a linked login can
  -- be notified; the rest simply see it when they next sign in.
  insert into public.notifications (org_id, user_id, kind, title, body, link)
  select r.org_id, m.user_id, 'payslip',
         'Your payslip for ' || r.period_month || ' is ready',
         'Net pay ' || to_char(i.net, 'FM99,99,99,990') || '. Open My Payroll to see the breakup.',
         '/me/payroll'
    from public.pay_run_items i
    join public.org_members m on m.employee_id = i.employee_id and m.org_id = r.org_id and m.is_active
   where i.run_id = p_run and not i.hold;

  perform app.log_event(r.org_id, 'payroll.payslips_published', 'pay_run', p_run::text,
                        jsonb_build_object('count', n));
  return n;
end $$;
