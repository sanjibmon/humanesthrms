-- Payroll. The calculation itself is done by the tested TypeScript engine (packages/payroll-engine);
-- the database owns the data, the inputs contract, the run state machine and the access rules.
--
-- Access model
--   * Payroll staff (payroll.read / payroll.run / payroll.approve / payroll.pay) need MFA (AAL2).
--   * An employee reads only their own compensation, published payslips, declarations and loans.
--   * Managers, HR without payroll permissions, and HumaNest support never see payroll data.
--   * A pay run moves draft -> computed -> approved -> locked -> paid. Locked runs are immutable;
--     corrections are made in the next run (arrears) or an off-cycle run.

create or replace function app.module_enabled(org uuid, module text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.organization_modules m where m.org_id = org and m.module_code = module and m.enabled)
$$;

-- Financial year helpers (India: April to March). fy_start_ym('2026-08') = '2026-04'; fy_start_ym('2027-02') = '2026-04'.
create or replace function app.fy_start_ym(ym text) returns text
language sql immutable as $$
  select case when substr(ym, 6, 2)::int >= 4 then substr(ym, 1, 4) || '-04'
              else (substr(ym, 1, 4)::int - 1)::text || '-04' end
$$;

-- ---------------------------------------------------------------------------------------------
-- Salary structures and compensation
-- ---------------------------------------------------------------------------------------------
create table public.salary_structures (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  code       text not null,
  name       text not null,
  template   jsonb not null,                       -- engine GradeTemplate (components, rules, ctcIncludesEmployerCosts)
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, code),
  check (jsonb_typeof(template -> 'components') = 'array')
);
create trigger trg_salary_structures_touch before update on public.salary_structures
  for each row execute function app.touch_updated_at();

create table public.employee_compensation (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  employee_id    uuid not null,
  effective_from date not null,
  annual_ctc     numeric(14,2) not null check (annual_ctc > 0),
  structure_id   uuid not null,
  grade          text,
  revision_reason text,
  status         text not null default 'draft' check (status in ('draft','approved')),
  created_by     uuid,
  approved_by    uuid,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (employee_id, effective_from),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (structure_id, org_id) references public.salary_structures (id, org_id)
);
create index on public.employee_compensation (org_id, employee_id, effective_from desc);

-- Maker-checker for salary changes. Approved rows never change: a revision is a new row.
create or replace function app.compensation_guard() returns trigger
language plpgsql as $$
declare mc boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then raise exception 'Approved compensation cannot be deleted; add a revision' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'Approved compensation is immutable; add a revision with a later effective date' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, app.uid()); end if;
  if new.status = 'approved' then
    select coalesce(s.payroll_maker_checker, true) into mc from public.org_settings s where s.org_id = new.org_id;
    mc := coalesce(mc, true);
    new.approved_by := coalesce(new.approved_by, app.uid());
    new.approved_at := coalesce(new.approved_at, now());
    if mc and new.approved_by is not distinct from new.created_by then
      raise exception 'Maker-checker: a different person must approve this salary change' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_comp_guard before insert or update or delete on public.employee_compensation
  for each row execute function app.compensation_guard();

create table public.prior_employer_income (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  employee_id uuid not null,
  fy_start    integer not null check (fy_start between 2020 and 2100),
  income      numeric(14,2) not null default 0 check (income >= 0),
  tds         numeric(14,2) not null default 0 check (tds >= 0),
  created_at  timestamptz not null default now(),
  unique (employee_id, fy_start),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Pay runs, items and payslips
-- ---------------------------------------------------------------------------------------------
create table public.pay_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  entity_id       uuid,
  period_month    text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  run_type        text not null default 'regular' check (run_type in ('regular','off_cycle','bonus','fnf')),
  status          text not null default 'draft' check (status in ('draft','computed','approved','locked','paid','cancelled')),
  created_by      uuid,
  computed_at     timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  locked_at       timestamptz,
  paid_by         uuid,
  paid_at         timestamptz,
  totals          jsonb not null default '{}'::jsonb,
  params_snapshot jsonb,                           -- statutory parameters used, so the run can be reproduced
  engine_version  text,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (id, org_id),
  foreign key (entity_id, org_id) references public.legal_entities (id, org_id)
);
create unique index pay_runs_one_regular on public.pay_runs
  (org_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), period_month)
  where run_type = 'regular' and status <> 'cancelled';
create index on public.pay_runs (org_id, period_month desc);

create or replace function app.pay_run_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Pay runs are never deleted; cancel them' using errcode = '42501'; end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'    and new.status in ('computed','cancelled')) or
      (old.status = 'computed' and new.status in ('computed','approved','cancelled','draft')) or
      (old.status = 'approved' and new.status in ('locked','computed')) or
      (old.status = 'locked'   and new.status = 'paid')
    ) then
      raise exception 'Invalid pay run transition % -> %', old.status, new.status using errcode = '23514';
    end if;
  elsif old.status in ('locked','paid','cancelled') and (to_jsonb(new) - 'paid_at' - 'paid_by') is distinct from (to_jsonb(old) - 'paid_at' - 'paid_by') then
    raise exception 'A % pay run cannot be changed', old.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_pay_run_guard before update or delete on public.pay_runs
  for each row execute function app.pay_run_guard();

create table public.pay_run_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  run_id          uuid not null,
  employee_id     uuid not null,
  paid_days       numeric(5,2) not null,
  lop_days        numeric(5,2) not null default 0,
  gross           numeric(14,2) not null,
  total_deductions numeric(14,2) not null,
  net             numeric(14,2) not null,
  employer_cost   numeric(14,2) not null default 0,
  pf_employee     numeric(12,2) not null default 0,
  esi_employee    numeric(12,2) not null default 0,
  pt              numeric(10,2) not null default 0,
  tds             numeric(12,2) not null default 0,
  payload         jsonb not null,                  -- full engine output incl. nextYtd
  hold            boolean not null default false,
  hold_reason     text,
  created_at      timestamptz not null default now(),
  unique (run_id, employee_id),
  foreign key (run_id, org_id) references public.pay_runs (id, org_id) on delete cascade,
  foreign key (employee_id, org_id) references public.employees (id, org_id)
);
create index on public.pay_run_items (org_id, employee_id);

create or replace function app.pay_run_item_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare st text; rid uuid := coalesce(new.run_id, old.run_id);
begin
  select status into st from public.pay_runs where id = rid;
  if st is not null and st not in ('draft','computed') then
    raise exception 'Items of a % pay run cannot be changed', st using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_pay_run_item_guard before insert or update or delete on public.pay_run_items
  for each row execute function app.pay_run_item_guard();

create table public.payslips (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  employee_id  uuid not null,
  run_id       uuid not null,
  period_month text not null,
  published_at timestamptz not null default now(),
  published_by uuid,
  unique (run_id, employee_id),
  foreign key (run_id, org_id) references public.pay_runs (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.payslips (org_id, employee_id, period_month desc);

create table public.pay_adjustments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  employee_id  uuid not null,
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind         text not null check (kind in ('incentive','arrears','bonus','reimbursement','overtime_hours','deduction')),
  description  text not null,
  amount       numeric(14,2) not null check (amount >= 0),   -- hours for overtime_hours
  status       text not null default 'pending' check (status in ('pending','applied','cancelled')),
  run_id       uuid,
  created_by   uuid default app.uid(),
  created_at   timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.pay_adjustments (org_id, period_month) where status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- Tax declarations (old-regime deductions, HRA rent, previous employer)
-- ---------------------------------------------------------------------------------------------
create table public.tax_declarations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  employee_id  uuid not null,
  fy_start     integer not null check (fy_start between 2020 and 2100),
  regime       text not null default 'new' check (regime in ('new','old')),
  status       text not null default 'draft' check (status in ('draft','submitted','verified','locked')),
  submitted_at timestamptz,
  verified_by  uuid,
  verified_at  timestamptz,
  unique (id, org_id),
  unique (employee_id, fy_start),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create table public.tax_declaration_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  declaration_id  uuid not null,
  section         text not null check (section in ('80c','80ccd1b','employer_nps','80d','80e','home_loan_interest','other_chapter_via','rent','lta','other_income')),
  description     text,
  declared_amount numeric(14,2) not null check (declared_amount >= 0),
  verified_amount numeric(14,2) check (verified_amount is null or verified_amount >= 0),
  city            text,                              -- rent: city of residence, decides the metro rate
  proof_path      text,
  status          text not null default 'pending' check (status in ('pending','accepted','rejected')),
  foreign key (declaration_id, org_id) references public.tax_declarations (id, org_id) on delete cascade
);
create index on public.tax_declaration_items (declaration_id);

-- Employees may edit only while the declaration is a draft or submitted (not once payroll verified it).
create or replace function app.tax_item_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare st text; did uuid := coalesce(new.declaration_id, old.declaration_id); org uuid := coalesce(new.org_id, old.org_id);
begin
  select status into st from public.tax_declarations where id = did;
  if st in ('verified','locked') and not app.can_mfa(org, 'payroll.run') then
    raise exception 'The declaration is % and can no longer be changed', st using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.status <> 'pending' and not app.can_mfa(org, 'payroll.run') then
    raise exception 'Only payroll can accept or reject a proof' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_tax_item_guard before insert or update or delete on public.tax_declaration_items
  for each row execute function app.tax_item_guard();

-- ---------------------------------------------------------------------------------------------
-- Loans and advances (EMI recovered through payroll)
-- ---------------------------------------------------------------------------------------------
create table public.loans (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  employee_id   uuid not null,
  kind          text not null default 'loan' check (kind in ('loan','advance')),
  principal     numeric(14,2) not null check (principal > 0),
  interest_rate_pct numeric(5,2) not null default 0 check (interest_rate_pct >= 0),
  emi           numeric(14,2) not null check (emi > 0),
  start_month   text not null check (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  outstanding   numeric(14,2) not null check (outstanding >= 0),
  status        text not null default 'active' check (status in ('active','closed','cancelled')),
  approved_by   uuid,
  created_by    uuid default app.uid(),
  created_at    timestamptz not null default now(),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create table public.loan_repayments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  loan_id      uuid not null,
  period_month text not null,
  amount       numeric(14,2) not null check (amount > 0),
  run_id       uuid,
  unique (loan_id, period_month),
  foreign key (loan_id, org_id) references public.loans (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Full and final settlement
-- ---------------------------------------------------------------------------------------------
create table public.fnf_settlements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  employee_id      uuid not null,
  last_working_day date not null,
  payload          jsonb not null default '{}'::jsonb,   -- leave encashment, gratuity, bonus, notice recovery, loans, TDS
  gross            numeric(14,2) not null default 0,
  deductions       numeric(14,2) not null default 0,
  net              numeric(14,2) not null default 0,
  status           text not null default 'draft' check (status in ('draft','approved','paid')),
  created_by       uuid default app.uid(),
  approved_by      uuid,
  approved_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (employee_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create table public.payment_batches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  run_id         uuid not null,
  format         text not null default 'generic_csv',
  employee_count integer not null,
  total_amount   numeric(16,2) not null,
  file_path      text,                              -- private storage; bank details never sit in this table
  status         text not null default 'generated' check (status in ('generated','uploaded','reconciled')),
  generated_by   uuid default app.uid(),
  generated_at   timestamptz not null default now(),
  foreign key (run_id, org_id) references public.pay_runs (id, org_id)
);

-- ---------------------------------------------------------------------------------------------
-- Statutory filings register (PF ECR, ESI, PT, LWF, TDS challans and returns, Form 16 issue)
-- ---------------------------------------------------------------------------------------------
create table public.statutory_filings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  entity_id    uuid,
  filing_type  text not null check (filing_type in ('pf_ecr','pf_challan','esi_return','esi_challan','pt_return','lwf_return','tds_challan','tds_return','form16','annual_return','other')),
  state_code   text,
  period       text not null,                       -- 2026-09, 2026-Q2, FY2026-27
  due_date     date not null,
  status       text not null default 'pending' check (status in ('pending','prepared','filed')),
  amount       numeric(14,2),
  reference_no text,
  filed_on     date,
  file_path    text,
  prepared_by  uuid,
  filed_by     uuid,
  notes        text,
  created_at   timestamptz not null default now(),
  foreign key (entity_id, org_id) references public.legal_entities (id, org_id)
);
create unique index statutory_filings_unique on public.statutory_filings
  (org_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), filing_type, coalesce(state_code, ''), period);
create index on public.statutory_filings (org_id, due_date) where status <> 'filed';

-- ---------------------------------------------------------------------------------------------
-- Inputs contract for the engine. One call returns everything needed for a run; the app tier feeds it
-- to computeEmployeeMonth and hands the results back through app.save_pay_run_items.
-- ---------------------------------------------------------------------------------------------
create or replace function app.payroll_days(emp uuid, m text)
returns table (total_days integer, paid_days numeric, lop_days numeric, attendance_days_recorded integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  e public.employees%rowtype;
  ms date := (m || '-01')::date;
  me date := (ms + interval '1 month - 1 day')::date;
  cal integer := extract(day from me)::int;
  basis text;
  base integer;
  from_d date; to_d date; eligible integer; lop numeric; unpaid numeric; rec integer;
begin
  select * into e from public.employees where id = emp;
  select coalesce(s.payroll_day_basis, 'calendar') into basis from public.org_settings s where s.org_id = e.org_id;
  basis := coalesce(basis, 'calendar');
  base := case basis when '26' then 26 when '30' then 30 else cal end;
  from_d := greatest(e.doj, ms);
  to_d := least(coalesce(e.exit_date, me), me);
  if to_d < from_d then
    return query select base, 0::numeric, base::numeric, 0; return;
  end if;
  eligible := (to_d - from_d) + 1;
  select coalesce(sum(case a.status when 'absent' then 1 when 'half_day' then 0.5 else 0 end), 0), count(*)::int
    into lop, rec from public.attendance_daily a
   where a.employee_id = emp and a.work_date between from_d and to_d;
  select coalesce(sum(app.leave_days(e.org_id, greatest(r.from_date, from_d), least(r.to_date, to_d),
                                     case when r.half_day <> 'none' then r.half_day else 'none' end)), 0) into unpaid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
   where r.employee_id = emp and r.status = 'approved' and not t.is_paid
     and r.from_date <= to_d and r.to_date >= from_d;
  return query select base,
    greatest(0::numeric, least(base::numeric, base - (cal - eligible) - lop - unpaid)),
    lop + unpaid, rec;
end $$;

create or replace function app.payroll_inputs(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r public.pay_runs%rowtype;
  st public.org_settings%rowtype;
  ms date; me date; fy_ym text; fy_int int; esi_from text;
  emps jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
  e record; c record; d record; decl jsonb; ytd jsonb; var jsonb; ded jsonb; prev jsonb; esi_lock boolean;
begin
  select * into r from public.pay_runs where id = p_run;
  if not found then raise exception 'Unknown pay run'; end if;
  if not app.can_mfa(r.org_id, 'payroll.run') then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into st from public.org_settings where org_id = r.org_id;
  ms := (r.period_month || '-01')::date;
  me := (ms + interval '1 month - 1 day')::date;
  fy_ym := app.fy_start_ym(r.period_month);
  fy_int := substr(fy_ym, 1, 4)::int;
  esi_from := case when substr(r.period_month, 6, 2)::int between 4 and 9 then substr(r.period_month, 1, 4) || '-04'
                   when substr(r.period_month, 6, 2)::int >= 10 then substr(r.period_month, 1, 4) || '-10'
                   else (substr(r.period_month, 1, 4)::int - 1)::text || '-10' end;

  for e in
    select emp.*, p.gender, p.dob, s.tax_regime, s.pf_applicable, s.pf_on_actual, s.esi_applicable, s.pt_applicable, s.lwf_applicable,
           (s.pan_enc is not null) as has_pan, coalesce(l.state_code, le.state_code) as state_code, l.city
      from public.employees emp
      left join public.employee_personal p on p.employee_id = emp.id
      left join public.employee_statutory s on s.employee_id = emp.id
      left join public.locations l on l.id = emp.location_id
      left join public.legal_entities le on le.id = emp.entity_id
     where emp.org_id = r.org_id
       and (r.entity_id is null or emp.entity_id = r.entity_id)
       and emp.doj <= me
       and emp.status in ('active','on_notice','exited','onboarding')
       and (emp.exit_date is null or emp.exit_date >= ms)
     order by emp.employee_code
  loop
    select comp.*, t.template into c
      from public.employee_compensation comp join public.salary_structures t on t.id = comp.structure_id
     where comp.employee_id = e.id and comp.status = 'approved' and comp.effective_from <= me
     order by comp.effective_from desc limit 1;
    if not found then
      skipped := skipped || jsonb_build_object('employeeId', e.id, 'code', e.employee_code, 'reason', 'no approved compensation');
      continue;
    end if;
    if e.state_code is null then
      skipped := skipped || jsonb_build_object('employeeId', e.id, 'code', e.employee_code, 'reason', 'no work location state (needed for PT and LWF)');
      continue;
    end if;
    select * into d from app.payroll_days(e.id, r.period_month);

    select jsonb_build_object(
      'incentives',    coalesce(sum(amount) filter (where kind = 'incentive'), 0),
      'arrears',       coalesce(sum(amount) filter (where kind = 'arrears'), 0),
      'bonus',         coalesce(sum(amount) filter (where kind = 'bonus'), 0),
      'reimbursements',coalesce(sum(amount) filter (where kind = 'reimbursement'), 0),
      'overtimeHours', coalesce(sum(amount) filter (where kind = 'overtime_hours'), 0)),
      jsonb_build_object('other', coalesce(sum(amount) filter (where kind = 'deduction'), 0))
      into var, ded
      from public.pay_adjustments a
     where a.employee_id = e.id and a.period_month = r.period_month and a.status = 'pending';
    ded := ded || jsonb_build_object(
      'loanEmi', coalesce((select sum(least(l.emi, l.outstanding)) from public.loans l
                            where l.employee_id = e.id and l.kind = 'loan' and l.status = 'active' and l.start_month <= r.period_month), 0),
      'advanceRecovery', coalesce((select sum(least(l.emi, l.outstanding)) from public.loans l
                            where l.employee_id = e.id and l.kind = 'advance' and l.status = 'active' and l.start_month <= r.period_month), 0));

    select coalesce(jsonb_object_agg(k, v) filter (where k is not null), '{}'::jsonb) into decl from (
      select case i.section when '80c' then 'c80' when '80ccd1b' then 'c80ccd1b' when 'employer_nps' then 'employerNps' when '80d' then 'c80d'
                            when '80e' then 'c80e' when 'home_loan_interest' then 'homeLoanInterest' when 'other_chapter_via' then 'otherChapterVIA'
                            when 'rent' then 'rentPaidAnnual' when 'lta' then 'ltaExempt' when 'other_income' then 'otherIncome' end as k,
             sum(coalesce(i.verified_amount, i.declared_amount)) as v
        from public.tax_declaration_items i join public.tax_declarations t on t.id = i.declaration_id
       where t.employee_id = e.id and t.fy_start = fy_int and t.status in ('submitted','verified','locked') and i.status <> 'rejected'
       group by i.section) x;
    if e.tax_regime = 'old' then
      decl := decl || coalesce((select jsonb_build_object('cityForHra', i.city) from public.tax_declaration_items i
                                  join public.tax_declarations t on t.id = i.declaration_id
                                 where t.employee_id = e.id and t.fy_start = fy_int and i.section = 'rent' and i.city is not null limit 1), '{}'::jsonb);
    end if;

    select i.payload -> 'nextYtd' into ytd
      from public.pay_run_items i join public.pay_runs pr on pr.id = i.run_id
     where i.employee_id = e.id and pr.status in ('approved','locked','paid') and pr.id <> r.id
       and pr.period_month >= fy_ym and (pr.period_month, pr.created_at) < (r.period_month, r.created_at)
     order by pr.period_month desc, pr.created_at desc limit 1;
    ytd := coalesce(ytd, jsonb_build_object('taxableGross', 0, 'basicDa', 0, 'hra', 0, 'employeePf', 0, 'pt', 0, 'tds', 0));

    select jsonb_build_object('income', income, 'tds', tds) into prev from public.prior_employer_income where employee_id = e.id and fy_start = fy_int;

    select exists (select 1 from public.pay_run_items i join public.pay_runs pr on pr.id = i.run_id
                    where i.employee_id = e.id and pr.status in ('approved','locked','paid')
                      and pr.period_month >= esi_from and pr.period_month < r.period_month
                      and coalesce((i.payload -> 'esi' ->> 'applicable')::boolean, false)) into esi_lock;

    emps := emps || jsonb_build_object(
      'employeeId', e.id, 'code', e.employee_code, 'name', e.full_name, 'doj', e.doj, 'exitDate', e.exit_date,
      'state', e.state_code, 'city', e.city, 'gender', e.gender, 'dob', e.dob, 'hasPan', coalesce(e.has_pan, false),
      'regime', coalesce(e.tax_regime, 'new'),
      'flags', jsonb_build_object('pf', coalesce(e.pf_applicable, true), 'pfOnActual', coalesce(e.pf_on_actual, st.pf_on_actual_default, false),
                                  'esi', coalesce(e.esi_applicable, false), 'pt', coalesce(e.pt_applicable, true), 'lwf', coalesce(e.lwf_applicable, true)),
      'compensation', jsonb_build_object('annualCtc', c.annual_ctc, 'effectiveFrom', c.effective_from, 'grade', c.grade, 'template', c.template),
      'calendar', jsonb_build_object('totalDays', d.total_days, 'paidDays', d.paid_days, 'lopDays', d.lop_days, 'attendanceRecorded', d.attendance_days_recorded),
      'variable', var, 'deductions', ded, 'declarations', decl, 'ytd', ytd, 'previousEmployer', prev, 'esiLockedInForPeriod', esi_lock);
  end loop;

  return jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'month', r.period_month, 'type', r.run_type, 'entityId', r.entity_id),
    'settings', jsonb_build_object('wageDefinition', coalesce(st.wage_definition, 'labour_code'),
                                   'esiIncludesOvertime', coalesce(st.esi_includes_overtime, true),
                                   'dayBasis', coalesce(st.payroll_day_basis, 'calendar')),
    'employees', emps, 'skipped', skipped);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Run lifecycle
-- ---------------------------------------------------------------------------------------------
create or replace function app.create_pay_run(p_org uuid, p_month text, p_entity uuid default null, p_type text default 'regular')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid;
begin
  if not app.can_mfa(p_org, 'payroll.run') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if not app.module_enabled(p_org, 'payroll') then raise exception 'The Payroll module is not enabled for this organisation'; end if;
  insert into public.pay_runs (org_id, entity_id, period_month, run_type, created_by)
  values (p_org, p_entity, p_month, p_type, app.uid()) returning id into rid;
  return rid;
end $$;

create or replace function app.save_pay_run_items(p_run uuid, p_items jsonb, p_params jsonb, p_engine_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.pay_runs%rowtype; it jsonb; n integer := 0;
  tot_gross numeric := 0; tot_net numeric := 0; tot_ded numeric := 0; tot_cost numeric := 0; tot_tds numeric := 0; tot_pf numeric := 0;
begin
  select * into r from public.pay_runs where id = p_run for update;
  if not found or not app.can_mfa(r.org_id, 'payroll.run') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status not in ('draft','computed') then raise exception 'Pay run is %; it can no longer be recomputed', r.status; end if;
  delete from public.pay_run_items where run_id = p_run;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.pay_run_items (org_id, run_id, employee_id, paid_days, lop_days, gross, total_deductions, net, employer_cost,
                                      pf_employee, esi_employee, pt, tds, payload)
    values (r.org_id, p_run, (it ->> 'employeeId')::uuid, (it ->> 'paidDays')::numeric, coalesce((it ->> 'lopDays')::numeric, 0),
            (it ->> 'gross')::numeric, (it ->> 'totalDeductions')::numeric, (it ->> 'net')::numeric, coalesce((it ->> 'employerCost')::numeric, 0),
            coalesce((it -> 'pf' ->> 'employee')::numeric, 0), coalesce((it -> 'esi' ->> 'employee')::numeric, 0),
            coalesce((it -> 'pt' ->> 'amount')::numeric, 0), coalesce((it -> 'tds' ->> 'tdsThisMonth')::numeric, 0), it);
    n := n + 1;
    tot_gross := tot_gross + (it ->> 'gross')::numeric; tot_net := tot_net + (it ->> 'net')::numeric;
    tot_ded := tot_ded + (it ->> 'totalDeductions')::numeric; tot_cost := tot_cost + coalesce((it ->> 'employerCost')::numeric, 0);
  end loop;
  select coalesce(sum(tds), 0), coalesce(sum(pf_employee), 0) into tot_tds, tot_pf from public.pay_run_items where run_id = p_run;
  update public.pay_runs set status = 'computed', computed_at = now(), params_snapshot = p_params, engine_version = p_engine_version,
         totals = jsonb_build_object('employees', n, 'gross', tot_gross, 'deductions', tot_ded, 'net', tot_net, 'employerCost', tot_cost, 'tds', tot_tds, 'employeePf', tot_pf)
   where id = p_run;
  return jsonb_build_object('employees', n, 'gross', tot_gross, 'net', tot_net);
end $$;

create or replace function app.approve_pay_run(p_run uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pay_runs%rowtype; mc boolean;
begin
  select * into r from public.pay_runs where id = p_run for update;
  if not found or not app.can_mfa(r.org_id, 'payroll.approve') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status <> 'computed' then raise exception 'Only a computed pay run can be approved (status is %)', r.status; end if;
  select coalesce(payroll_maker_checker, true) into mc from public.org_settings where org_id = r.org_id;
  mc := coalesce(mc, true);
  -- the approver must differ from whoever computed the run
  if mc and r.created_by is not distinct from app.uid() then
    raise exception 'Maker-checker: a different person must approve this pay run' using errcode = '42501';
  end if;
  if exists (select 1 from public.pay_run_items where run_id = p_run and (net < 0)) then
    raise exception 'A negative net pay exists; fix it or place the employee on hold before approval';
  end if;
  update public.pay_runs set status = 'approved', approved_by = app.uid(), approved_at = now() where id = p_run;
  perform app.log_event(r.org_id, 'payroll.approved', 'pay_run', p_run::text, r.totals);
end $$;

create or replace function app.reopen_pay_run(p_run uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pay_runs%rowtype;
begin
  select * into r from public.pay_runs where id = p_run for update;
  if not found or not app.can_mfa(r.org_id, 'payroll.approve') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved (not yet locked) run can be reopened'; end if;
  if coalesce(length(p_reason), 0) < 5 then raise exception 'A reason is required'; end if;
  update public.pay_runs set status = 'computed', approved_by = null, approved_at = null where id = p_run;
  perform app.log_event(r.org_id, 'payroll.reopened', 'pay_run', p_run::text, jsonb_build_object('reason', p_reason));
end $$;

-- Lock: freezes the run, locks the attendance it used, consumes adjustments and records loan recoveries.
create or replace function app.lock_pay_run(p_run uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pay_runs%rowtype; ms date; me date; li record; v_emi numeric;
begin
  select * into r from public.pay_runs where id = p_run for update;
  if not found or not app.can_mfa(r.org_id, 'payroll.approve') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved pay run can be locked'; end if;
  ms := (r.period_month || '-01')::date; me := (ms + interval '1 month - 1 day')::date;
  update public.pay_runs set status = 'locked', locked_at = now() where id = p_run;
  update public.attendance_daily a set locked = true
   where a.org_id = r.org_id and a.work_date between ms and me
     and a.employee_id in (select employee_id from public.pay_run_items where run_id = p_run);
  update public.pay_adjustments a set status = 'applied', run_id = p_run
   where a.org_id = r.org_id and a.period_month = r.period_month and a.status = 'pending'
     and a.employee_id in (select employee_id from public.pay_run_items where run_id = p_run);
  for li in select l.id, l.emi, l.outstanding, l.employee_id from public.loans l
             where l.org_id = r.org_id and l.status = 'active' and l.start_month <= r.period_month
               and l.employee_id in (select employee_id from public.pay_run_items where run_id = p_run) loop
    v_emi := least(li.emi, li.outstanding);
    insert into public.loan_repayments (org_id, loan_id, period_month, amount, run_id) values (r.org_id, li.id, r.period_month, v_emi, p_run)
      on conflict (loan_id, period_month) do nothing;
    update public.loans set outstanding = outstanding - v_emi, status = case when outstanding - v_emi <= 0 then 'closed' else status end where id = li.id;
  end loop;
  perform app.log_event(r.org_id, 'payroll.locked', 'pay_run', p_run::text, r.totals);
end $$;

create or replace function app.publish_payslips(p_run uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pay_runs%rowtype; n integer;
begin
  select * into r from public.pay_runs where id = p_run;
  if not found or not app.can_mfa(r.org_id, 'payroll.run') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status not in ('locked','paid') then raise exception 'Payslips can be published only after the run is locked'; end if;
  insert into public.payslips (org_id, employee_id, run_id, period_month, published_by)
  select i.org_id, i.employee_id, i.run_id, r.period_month, app.uid() from public.pay_run_items i
   where i.run_id = p_run and not i.hold
  on conflict (run_id, employee_id) do nothing;
  get diagnostics n = row_count;
  perform app.log_event(r.org_id, 'payroll.payslips_published', 'pay_run', p_run::text, jsonb_build_object('count', n));
  return n;
end $$;

create or replace function app.mark_pay_run_paid(p_run uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pay_runs%rowtype;
begin
  select * into r from public.pay_runs where id = p_run for update;
  if not found or not app.can_mfa(r.org_id, 'payroll.pay') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status <> 'locked' then raise exception 'Only a locked pay run can be marked paid'; end if;
  update public.pay_runs set status = 'paid', paid_at = now(), paid_by = app.uid() where id = p_run;
  perform app.log_event(r.org_id, 'payroll.paid', 'pay_run', p_run::text, r.totals);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.salary_structures       enable row level security;
alter table public.employee_compensation  enable row level security;
alter table public.prior_employer_income   enable row level security;
alter table public.pay_runs                enable row level security;
alter table public.pay_run_items           enable row level security;
alter table public.payslips                enable row level security;
alter table public.pay_adjustments         enable row level security;
alter table public.tax_declarations        enable row level security;
alter table public.tax_declaration_items   enable row level security;
alter table public.loans                   enable row level security;
alter table public.loan_repayments         enable row level security;
alter table public.fnf_settlements         enable row level security;
alter table public.payment_batches         enable row level security;
alter table public.statutory_filings       enable row level security;

create policy structures_select on public.salary_structures for select to authenticated using (app.can_mfa(org_id, 'payroll.read'));
create policy structures_write  on public.salary_structures for all to authenticated
  using (app.can_mfa(org_id, 'payroll.config')) with check (app.can_mfa(org_id, 'payroll.config'));

-- own compensation is visible to the employee (approved rows only); payroll staff see everything with MFA
create policy comp_select on public.employee_compensation for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or (employee_id = app.my_employee_id(org_id) and status = 'approved'));
create policy comp_write on public.employee_compensation for all to authenticated
  using (app.can_mfa(org_id, 'payroll.config')) with check (app.can_mfa(org_id, 'payroll.config'));

create policy prior_income_select on public.prior_employer_income for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or employee_id = app.my_employee_id(org_id));
create policy prior_income_write on public.prior_employer_income for all to authenticated
  using (app.can_mfa(org_id, 'payroll.run')) with check (app.can_mfa(org_id, 'payroll.run'));

create policy runs_select on public.pay_runs for select to authenticated using (app.can_mfa(org_id, 'payroll.read'));
-- no write policies: runs change only through the app.*_pay_run functions

create policy items_select on public.pay_run_items for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read')
         or (employee_id = app.my_employee_id(org_id)
             and exists (select 1 from public.payslips p where p.run_id = pay_run_items.run_id and p.employee_id = pay_run_items.employee_id)));

create policy payslips_select on public.payslips for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or employee_id = app.my_employee_id(org_id));

create policy adjustments_select on public.pay_adjustments for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or employee_id = app.my_employee_id(org_id));
create policy adjustments_write on public.pay_adjustments for all to authenticated
  using (app.can_mfa(org_id, 'payroll.run') and status = 'pending') with check (app.can_mfa(org_id, 'payroll.run'));

create policy taxdecl_select on public.tax_declarations for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or employee_id = app.my_employee_id(org_id));
create policy taxdecl_insert_self on public.tax_declarations for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and status in ('draft','submitted'));
create policy taxdecl_update_self on public.tax_declarations for update to authenticated
  using (employee_id = app.my_employee_id(org_id) and status in ('draft','submitted'))
  with check (employee_id = app.my_employee_id(org_id) and status in ('draft','submitted'));
create policy taxdecl_payroll on public.tax_declarations for update to authenticated
  using (app.can_mfa(org_id, 'payroll.run')) with check (app.can_mfa(org_id, 'payroll.run'));

create policy taxitems_select on public.tax_declaration_items for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read')
         or exists (select 1 from public.tax_declarations d where d.id = declaration_id and d.employee_id = app.my_employee_id(d.org_id)));
create policy taxitems_write_self on public.tax_declaration_items for all to authenticated
  using (exists (select 1 from public.tax_declarations d where d.id = declaration_id and d.employee_id = app.my_employee_id(d.org_id)))
  with check (exists (select 1 from public.tax_declarations d where d.id = declaration_id and d.employee_id = app.my_employee_id(d.org_id)));
create policy taxitems_write_payroll on public.tax_declaration_items for all to authenticated
  using (app.can_mfa(org_id, 'payroll.run')) with check (app.can_mfa(org_id, 'payroll.run'));

create policy loans_select on public.loans for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or employee_id = app.my_employee_id(org_id));
create policy loans_write on public.loans for all to authenticated
  using (app.can_mfa(org_id, 'payroll.run')) with check (app.can_mfa(org_id, 'payroll.run'));
create policy loanrep_select on public.loan_repayments for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read')
         or exists (select 1 from public.loans l where l.id = loan_id and l.employee_id = app.my_employee_id(l.org_id)));

create policy fnf_select on public.fnf_settlements for select to authenticated
  using (app.can_mfa(org_id, 'payroll.read') or (employee_id = app.my_employee_id(org_id) and status in ('approved','paid')));
create policy fnf_write on public.fnf_settlements for all to authenticated
  using (app.can_mfa(org_id, 'payroll.run') and status = 'draft') with check (app.can_mfa(org_id, 'payroll.run'));

create policy batches_select on public.payment_batches for select to authenticated using (app.can_mfa(org_id, 'payroll.read'));
create policy batches_write on public.payment_batches for all to authenticated
  using (app.can_mfa(org_id, 'payroll.pay')) with check (app.can_mfa(org_id, 'payroll.pay'));

create policy filings_select on public.statutory_filings for select to authenticated using (app.can_mfa(org_id, 'compliance.read'));
create policy filings_write on public.statutory_filings for all to authenticated
  using (app.can_mfa(org_id, 'compliance.file')) with check (app.can_mfa(org_id, 'compliance.file'));

-- Audit: who changed pay, structures, loans, settlements, declarations and filings
create trigger trg_audit_salary_structures after insert or update or delete on public.salary_structures for each row execute function app.audit_row();
create trigger trg_audit_compensation      after insert or update or delete on public.employee_compensation for each row execute function app.audit_row();
create trigger trg_audit_pay_runs          after insert or update on public.pay_runs for each row execute function app.audit_row();
create trigger trg_audit_pay_adjustments   after insert or update or delete on public.pay_adjustments for each row execute function app.audit_row();
create trigger trg_audit_loans             after insert or update or delete on public.loans for each row execute function app.audit_row();
create trigger trg_audit_fnf               after insert or update or delete on public.fnf_settlements for each row execute function app.audit_row();
create trigger trg_audit_tax_declarations  after insert or update on public.tax_declarations for each row execute function app.audit_row();
create trigger trg_audit_filings           after insert or update or delete on public.statutory_filings for each row execute function app.audit_row();
