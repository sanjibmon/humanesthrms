-- Leave accrual, carry-forward and lapse; and approved overtime.
--
-- Leave balances have been a ledger from the start, which is right, but nothing
-- ever wrote the accrual entries -- somebody had to credit the year by hand.
-- app.run_leave_accrual does it properly and, more importantly, idempotently:
-- it keys each entry to the first day of the period it is for, so running it
-- twice, or running it late, or running it for a month that was already done,
-- credits nobody twice. That matters more than elegance here, because the first
-- thing anyone does with a button like this is press it again to see if it
-- worked.
--
-- What it implements:
--   monthly accrual   days_per_year / 12, from the month probation ends
--   yearly accrual    the whole entitlement at the start of the leave year, or
--                     a pro-rata share from the month a mid-year joiner becomes
--                     eligible, rounded to the half day leave is taken in
--   carry forward     last year's closing balance, capped at carry_max
--   lapse             whatever the cap did not carry, as its own entry dated to
--                     the old leave year, so the employee can see what they
--                     lost rather than finding a balance quietly smaller
--
-- The leave year is not always January: org_settings.leave_year_start_month
-- decides, and leave_ledger.leave_year is the calendar year that leave year
-- opened in, so April 2026 to March 2027 is leave year 2026 throughout.
--
-- There is no scheduler in this database (no pg_cron), so this is driven from
-- the Leave screen or by anything outside that can call the RPC monthly. The
-- idempotency is what makes that safe rather than fragile.

create or replace function app.leave_year_of(p_org uuid, d date)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when extract(month from d)::int >= coalesce((select leave_year_start_month from public.org_settings where org_id = p_org), 1)
      then extract(year from d)::int
    else extract(year from d)::int - 1
  end
$$;

create or replace function app.run_leave_accrual(p_org uuid, p_month text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  ms date; me date;
  start_month int;
  ly int;
  ly_start date;
  is_year_start boolean;
  t record;
  e record;
  per_month numeric;
  credited int := 0;
  carried int := 0;
  lapsed int := 0;
  prev_balance numeric;
  keep numeric;
  drop_days numeric;
  eligible_from date;
  months_left int;
  grant_days numeric;
begin
  if not app.can_mfa(p_org, 'leave.config') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must look like 2026-04' using errcode = '22023';
  end if;

  ms := (p_month || '-01')::date;
  me := (ms + interval '1 month - 1 day')::date;
  select coalesce(leave_year_start_month, 1) into start_month from public.org_settings where org_id = p_org;
  start_month := coalesce(start_month, 1);
  is_year_start := extract(month from ms)::int = start_month;
  ly := app.leave_year_of(p_org, ms);
  ly_start := make_date(ly, start_month, 1);

  for t in
    select * from public.leave_types
     where org_id = p_org and is_active and coalesce(days_per_year, 0) > 0
  loop
    per_month := round(coalesce(t.days_per_year, 0) / 12.0, 1);

    for e in
      select emp.id, emp.doj, emp.exit_date
        from public.employees emp
       where emp.org_id = p_org
         and emp.status in ('active', 'on_notice')
         and emp.doj <= me
         and (emp.exit_date is null or emp.exit_date >= ms)
    loop
      eligible_from := greatest(e.doj + coalesce(t.probation_days, 0), ly_start);
      if eligible_from > me then
        continue;
      end if;

      -- Carry forward and lapse, once, at the start of a leave year.
      if is_year_start then
        select coalesce(sum(delta), 0) into prev_balance
          from public.leave_ledger
         where employee_id = e.id and leave_type_id = t.id and leave_year = ly - 1;

        if prev_balance > 0 and not exists (
          select 1 from public.leave_ledger
           where employee_id = e.id and leave_type_id = t.id
             and entry_date = ms and reason in ('carry_forward', 'lapse')
        ) then
          if coalesce(t.carry_forward, false) then
            keep := least(prev_balance, coalesce(t.carry_max, prev_balance));
          else
            keep := 0;
          end if;
          drop_days := prev_balance - keep;

          if keep > 0 then
            insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year,
                                             delta, reason, note, created_by)
            values (p_org, e.id, t.id, ms, ly, keep, 'carry_forward',
                    'Carried forward from leave year ' || (ly - 1), app.uid());
            carried := carried + 1;
          end if;
          if drop_days > 0 then
            insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year,
                                             delta, reason, note, created_by)
            values (p_org, e.id, t.id, ms, ly - 1, -drop_days, 'lapse',
                    case when coalesce(t.carry_forward, false)
                         then 'Above the carry-forward cap of ' || coalesce(t.carry_max, 0) || ' days'
                         else 'This type does not carry forward' end, app.uid());
            lapsed := lapsed + 1;
          end if;
        end if;
      end if;

      if t.accrual = 'monthly' then
        if per_month > 0 and not exists (
          select 1 from public.leave_ledger
           where employee_id = e.id and leave_type_id = t.id
             and reason = 'accrual' and entry_date = ms
        ) then
          insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year,
                                           delta, reason, note, created_by)
          values (p_org, e.id, t.id, ms, ly, per_month, 'accrual',
                  'Monthly accrual for ' || p_month, app.uid());
          credited := credited + 1;
        end if;

      else
        if not exists (
          select 1 from public.leave_ledger
           where employee_id = e.id and leave_type_id = t.id
             and reason = 'accrual' and leave_year = ly
        ) then
          months_left := 12 - (
            (extract(year from date_trunc('month', eligible_from))::int - extract(year from ly_start)::int) * 12
            + (extract(month from eligible_from)::int - extract(month from ly_start)::int)
          );
          months_left := greatest(0, least(12, months_left));
          grant_days := round((t.days_per_year * months_left / 12.0) * 2) / 2;

          if grant_days > 0 then
            insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year,
                                             delta, reason, note, created_by)
            values (p_org, e.id, t.id, greatest(ms, ly_start), ly, grant_days, 'accrual',
                    case when months_left = 12
                         then 'Entitlement for leave year ' || ly
                         else 'Pro-rata entitlement for leave year ' || ly || ': ' || months_left || ' of 12 months' end,
                    app.uid());
            credited := credited + 1;
          end if;
        end if;
      end if;
    end loop;
  end loop;

  perform app.log_event(p_org, 'leave.accrual', 'leave_ledger', p_month,
    jsonb_build_object('credited', credited, 'carried', carried, 'lapsed', lapsed, 'leaveYear', ly));

  return jsonb_build_object('month', p_month, 'leaveYear', ly, 'yearStart', is_year_start,
                            'credited', credited, 'carried', carried, 'lapsed', lapsed);
end $$;

create or replace function api.run_leave_accrual(p_org uuid, p_month text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.run_leave_accrual(p_org, p_month) $$;

revoke all on function api.run_leave_accrual(uuid, text) from public;
grant execute on function api.run_leave_accrual(uuid, text) to authenticated;


-- Overtime. attendance_daily already records overtime_minutes, but payroll must
-- never price hours that nobody signed off, so approved minutes are a separate
-- column: recorded is what happened, approved is what gets paid.
alter table public.attendance_daily
  add column if not exists overtime_approved_minutes integer not null default 0;

create or replace function app.approve_overtime(p_org uuid, p_month text, p_employee uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare ms date; me date; n int; mins bigint;
begin
  if not app.can_mfa(p_org, 'attendance.approve') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must look like 2026-04' using errcode = '22023';
  end if;
  ms := (p_month || '-01')::date;
  me := (ms + interval '1 month - 1 day')::date;

  update public.attendance_daily a
     set overtime_approved_minutes = a.overtime_minutes, updated_at = now()
   where a.org_id = p_org
     and a.work_date between ms and me
     and not a.locked
     and coalesce(a.overtime_minutes, 0) > 0
     and a.overtime_approved_minutes <> coalesce(a.overtime_minutes, 0)
     and (p_employee is null or a.employee_id = p_employee);
  get diagnostics n = row_count;

  select coalesce(sum(overtime_approved_minutes), 0) into mins
    from public.attendance_daily
   where org_id = p_org and work_date between ms and me
     and (p_employee is null or employee_id = p_employee);

  perform app.log_event(p_org, 'attendance.overtime_approved', 'attendance_daily', p_month,
    jsonb_build_object('days', n, 'minutes', mins, 'employee', p_employee));

  return jsonb_build_object('days', n, 'minutes', mins);
end $$;

create or replace function api.approve_overtime(p_org uuid, p_month text, p_employee uuid default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.approve_overtime(p_org, p_month, p_employee) $$;

revoke all on function api.approve_overtime(uuid, text, uuid) from public;
grant execute on function api.approve_overtime(uuid, text, uuid) to authenticated;


-- Approved overtime reaching payroll. One adjustment per employee per month,
-- replaced rather than added to, so running it again after approving a few more
-- hours corrects the figure instead of doubling it.
create or replace function app.push_overtime_to_payroll(p_org uuid, p_month text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare ms date; me date; n int := 0; e record; hrs numeric;
begin
  if not app.can_mfa(p_org, 'payroll.run') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  ms := (p_month || '-01')::date;
  me := (ms + interval '1 month - 1 day')::date;

  for e in
    select employee_id, sum(overtime_approved_minutes) as mins
      from public.attendance_daily
     where org_id = p_org and work_date between ms and me
       and coalesce(overtime_approved_minutes, 0) > 0
     group by employee_id
  loop
    hrs := round(e.mins / 60.0, 2);
    delete from public.pay_adjustments
     where org_id = p_org and employee_id = e.employee_id and period_month = p_month
       and kind = 'overtime_hours' and status = 'pending';
    insert into public.pay_adjustments (org_id, employee_id, period_month, kind, description,
                                        amount, status, created_by)
    values (p_org, e.employee_id, p_month, 'overtime_hours',
            'Approved overtime: ' || e.mins || ' minutes', hrs, 'pending', app.uid());
    n := n + 1;
  end loop;

  perform app.log_event(p_org, 'payroll.overtime_pushed', 'pay_adjustments', p_month,
    jsonb_build_object('employees', n));
  return jsonb_build_object('employees', n);
end $$;

create or replace function api.push_overtime_to_payroll(p_org uuid, p_month text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.push_overtime_to_payroll(p_org, p_month) $$;

revoke all on function api.push_overtime_to_payroll(uuid, text) from public;
grant execute on function api.push_overtime_to_payroll(uuid, text) to authenticated;
