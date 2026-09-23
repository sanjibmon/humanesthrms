-- Recruitment, performance, helpdesk, assets, expenses and offboarding.
-- Same rules as the rest of the schema: org_id everywhere, composite same-org foreign keys, RLS on, writes that
-- change money or employment status go through functions, and every approval uses the shared approval engine.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function app.current_employee() returns table (org_id uuid, employee_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, m.employee_id from public.org_members m
   where m.user_id = app.uid() and m.is_active and m.employee_id is not null and app.org_is_usable(m.org_id)
   order by m.created_at limit 1
$$;

-- Module gate: refuse inserts for a module the customer has not bought. Attach with
-- create trigger ... execute function app.require_module('<module code>').
create or replace function app.require_module() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.module_enabled(new.org_id, tg_argv[0]) then
    raise exception 'The % module is not enabled for this organisation', tg_argv[0] using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Recruitment (ATS)
-- ---------------------------------------------------------------------------------------------
create table public.job_requisitions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  title               text not null,
  department_id       uuid,
  location_id         uuid,
  headcount           integer not null default 1 check (headcount between 1 and 500),
  employment_type     text not null default 'permanent' check (employment_type in ('permanent','fixed_term','contract','intern','consultant')),
  budget_min          numeric(14,2),
  budget_max          numeric(14,2),
  status              text not null default 'draft' check (status in ('draft','pending_approval','open','on_hold','closed')),
  hiring_manager_id   uuid,
  approval_request_id uuid,
  opened_on           date,
  created_by          uuid default app.uid(),
  created_at          timestamptz not null default now(),
  unique (id, org_id),
  check (budget_max is null or budget_min is null or budget_max >= budget_min),
  foreign key (hiring_manager_id, org_id) references public.employees (id, org_id)
);
create table public.candidates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  requisition_id uuid,
  full_name      text not null,
  email          text,
  phone          text,
  source         text not null default 'direct' check (source in ('direct','referral','portal','agency','campus','other')),
  referred_by    uuid,
  expected_ctc   numeric(14,2),
  stage          text not null default 'applied' check (stage in ('applied','screening','interview','offer','hired','rejected','withdrawn')),
  rating         numeric(3,1) check (rating between 0 and 10),
  resume_path    text,
  notes          text,
  consent_at     timestamptz,                             -- DPDP: candidate consent to process their data
  retain_until   date not null default (current_date + 365),   -- purge job deletes after this date unless renewed
  created_at     timestamptz not null default now(),
  unique (id, org_id),
  foreign key (requisition_id, org_id) references public.job_requisitions (id, org_id),
  foreign key (referred_by, org_id) references public.employees (id, org_id)
);
create index on public.candidates (org_id, stage);
create table public.interviews (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null,
  candidate_id             uuid not null,
  round_no                 integer not null default 1,
  interviewer_employee_id  uuid not null,
  scheduled_at             timestamptz,
  mode                     text not null default 'video' check (mode in ('video','phone','in_person')),
  status                   text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  score                    numeric(3,1) check (score between 0 and 10),
  feedback                 text,
  recommendation           text check (recommendation in ('strong_yes','yes','no','strong_no')),
  foreign key (candidate_id, org_id) references public.candidates (id, org_id) on delete cascade,
  foreign key (interviewer_employee_id, org_id) references public.employees (id, org_id)
);
create table public.offers (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  candidate_id        uuid not null,
  annual_ctc          numeric(14,2) not null check (annual_ctc > 0),
  designation         text,
  joining_date        date not null,
  status              text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','accepted','declined','withdrawn')),
  approval_request_id uuid,
  sent_at             timestamptz,
  decided_at          timestamptz,
  created_by          uuid default app.uid(),
  foreign key (candidate_id, org_id) references public.candidates (id, org_id) on delete cascade
);

create or replace function app.is_interviewer(cand uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.interviews i
                  where i.candidate_id = cand and i.interviewer_employee_id = app.my_employee_id(i.org_id))
$$;

-- ---------------------------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------------------------
create table public.review_cycles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  kind         text not null default 'annual' check (kind in ('annual','half_year','quarterly','probation')),
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft' check (status in ('draft','active','closed')),
  unique (id, org_id),
  check (period_end > period_start)
);
create table public.goals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  employee_id  uuid not null,
  cycle_id     uuid,
  parent_goal_id uuid,
  title        text not null,
  description  text,
  weight       numeric(5,2) not null default 0 check (weight between 0 and 100),
  target_value numeric(14,2),
  current_value numeric(14,2) not null default 0,
  status       text not null default 'on_track' check (status in ('draft','on_track','at_risk','off_track','done')),
  due_date     date,
  created_at   timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (cycle_id, org_id) references public.review_cycles (id, org_id)
);
create table public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  cycle_id             uuid not null,
  employee_id          uuid not null,
  reviewer_employee_id uuid not null,
  review_type          text not null check (review_type in ('self','manager','peer','skip_level')),
  rating               numeric(3,1) check (rating between 1 and 5),
  comments             text,
  status               text not null default 'draft' check (status in ('draft','submitted')),
  released             boolean not null default false,          -- manager/peer feedback is hidden from the employee until released
  submitted_at         timestamptz,
  unique (cycle_id, employee_id, reviewer_employee_id, review_type),
  foreign key (cycle_id, org_id) references public.review_cycles (id, org_id) on delete cascade,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (reviewer_employee_id, org_id) references public.employees (id, org_id)
);
create table public.recognitions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  from_employee_id uuid not null,
  to_employee_id   uuid not null,
  badge        text not null default 'thanks',
  message      text not null check (length(message) between 3 and 500),
  is_public    boolean not null default true,
  created_at   timestamptz not null default now(),
  foreign key (from_employee_id, org_id) references public.employees (id, org_id),
  foreign key (to_employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  check (from_employee_id <> to_employee_id)
);

-- ---------------------------------------------------------------------------------------------
-- HR helpdesk
-- ---------------------------------------------------------------------------------------------
create table public.helpdesk_categories (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  name      text not null,
  sla_hours integer not null default 48 check (sla_hours > 0),
  is_active boolean not null default true,
  unique (id, org_id),
  unique (org_id, name)
);
create table public.helpdesk_tickets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  ticket_no    text,
  employee_id  uuid not null,
  category_id  uuid,
  subject      text not null,
  description  text not null,
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status       text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  assigned_to  uuid,
  due_at       timestamptz,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (category_id, org_id) references public.helpdesk_categories (id, org_id),
  foreign key (assigned_to, org_id) references public.employees (id, org_id)
);
create table public.helpdesk_comments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  ticket_id  uuid not null,
  author_id  uuid default app.uid(),
  body       text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (ticket_id, org_id) references public.helpdesk_tickets (id, org_id) on delete cascade
);
create or replace function app.helpdesk_ticket_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare sla integer;
begin
  if tg_op = 'INSERT' then
    new.ticket_no := 'HD-' || lpad((select count(*) + 1 from public.helpdesk_tickets where org_id = new.org_id)::text, 5, '0');
    select c.sla_hours into sla from public.helpdesk_categories c where c.id = new.category_id;
    new.due_at := now() + make_interval(hours => coalesce(sla, 48));
  end if;
  if new.status in ('resolved','closed') and new.resolved_at is null then new.resolved_at := now(); end if;
  return new;
end $$;
create trigger trg_helpdesk_before before insert or update on public.helpdesk_tickets
  for each row execute function app.helpdesk_ticket_before();

-- ---------------------------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------------------------
create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  asset_tag     text not null,
  name          text not null,
  category      text not null default 'laptop',
  serial_no     text,
  purchase_date date,
  purchase_cost numeric(14,2),
  status        text not null default 'available' check (status in ('available','allocated','repair','retired','lost')),
  notes         text,
  unique (id, org_id),
  unique (org_id, asset_tag)
);
create table public.asset_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  asset_id      uuid not null,
  employee_id   uuid not null,
  allocated_on  date not null default current_date,
  returned_on   date,
  condition_out text,
  condition_in  text,
  acknowledged_at timestamptz,
  foreign key (asset_id, org_id) references public.assets (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  check (returned_on is null or returned_on >= allocated_on)
);
create unique index asset_one_open_allocation on public.asset_allocations (asset_id) where returned_on is null;

create or replace function app.asset_allocation_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.assets set status = case when new.returned_on is null then 'allocated' else 'available' end
   where id = new.asset_id and status in ('available','allocated');
  return null;
end $$;
create trigger trg_asset_allocation_after after insert or update of returned_on on public.asset_allocations
  for each row execute function app.asset_allocation_after();

-- ---------------------------------------------------------------------------------------------
-- Expenses and reimbursements
-- ---------------------------------------------------------------------------------------------
create table public.expense_policies (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  category               text not null,
  per_claim_limit        numeric(12,2),
  monthly_limit          numeric(12,2),
  receipt_required_above numeric(12,2) not null default 500,
  is_active              boolean not null default true,
  unique (org_id, category)
);
create table public.expense_claims (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  claim_no             text,
  employee_id          uuid not null,
  title                text not null,
  total                numeric(14,2) not null default 0,
  status               text not null default 'draft' check (status in ('draft','submitted','approved','rejected','paid')),
  approval_request_id  uuid,
  payout_adjustment_id uuid,
  submitted_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create table public.expense_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  claim_id     uuid not null,
  expense_date date not null check (expense_date <= current_date),
  category     text not null,
  merchant     text,
  amount       numeric(12,2) not null check (amount > 0),
  gst_amount   numeric(12,2) not null default 0 check (gst_amount >= 0),
  description  text,
  receipt_path text,
  foreign key (claim_id, org_id) references public.expense_claims (id, org_id) on delete cascade
);

create or replace function app.expense_item_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare st text; cid uuid := coalesce(new.claim_id, old.claim_id); lim numeric; recv numeric; sum_month numeric; mlim numeric;
begin
  select status into st from public.expense_claims where id = cid;
  if st <> 'draft' then raise exception 'Only a draft claim can be edited (status is %)', st using errcode = '42501'; end if;
  if tg_op <> 'DELETE' then
    select p.per_claim_limit, p.receipt_required_above, p.monthly_limit into lim, recv, mlim
      from public.expense_policies p where p.org_id = new.org_id and p.category = new.category and p.is_active;
    if lim is not null and new.amount > lim then
      raise exception 'POLICY: % exceeds the per-claim limit of % for %', new.amount, lim, new.category;
    end if;
    if recv is not null and new.amount > recv and coalesce(new.receipt_path, '') = '' then
      raise exception 'POLICY: a receipt is required for % above %', new.category, recv;
    end if;
    if mlim is not null then
      select coalesce(sum(i.amount), 0) into sum_month
        from public.expense_items i join public.expense_claims c on c.id = i.claim_id
       where c.employee_id = (select employee_id from public.expense_claims where id = cid)
         and i.category = new.category and date_trunc('month', i.expense_date) = date_trunc('month', new.expense_date)
         and c.status <> 'rejected' and i.id is distinct from new.id;
      if sum_month + new.amount > mlim then
        raise exception 'POLICY: monthly limit of % for % would be exceeded', mlim, new.category;
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_expense_item_guard before insert or update or delete on public.expense_items
  for each row execute function app.expense_item_guard();

create or replace function app.expense_item_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.expense_claims set total = coalesce((select sum(amount) from public.expense_items where claim_id = cid), 0) where id = cid;
  return null;
end $$;
create trigger trg_expense_item_after after insert or update or delete on public.expense_items
  for each row execute function app.expense_item_after();

create or replace function app.submit_expense(p_claim uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.expense_claims%rowtype; e public.employees%rowtype; steps jsonb := '[]'::jsonb; req uuid;
begin
  select * into c from public.expense_claims where id = p_claim for update;
  if not found or c.employee_id is distinct from app.my_employee_id(c.org_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if c.status <> 'draft' then raise exception 'Claim is already %', c.status; end if;
  if c.total <= 0 then raise exception 'Add at least one expense line'; end if;
  select * into e from public.employees where id = c.employee_id;
  if e.reporting_manager_id is not null then
    steps := steps || jsonb_build_array(jsonb_build_object('type','manager','employee_id',e.reporting_manager_id,'sla_hours',48));
  end if;
  steps := steps || jsonb_build_array(jsonb_build_object('type','finance','permission','expenses.approve','sla_hours',72));
  req := app.create_approval(c.org_id, 'expense', c.id, c.employee_id, steps, jsonb_build_object('total', c.total));
  update public.expense_claims set status = 'submitted', submitted_at = now(), approval_request_id = req,
         claim_no = 'EXP-' || lpad((select count(*) from public.expense_claims where org_id = c.org_id and claim_no is not null)::text, 5, '0')
   where id = c.id;
  return req;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Offboarding
-- ---------------------------------------------------------------------------------------------
create table public.exit_requests (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  employee_id         uuid not null,
  kind                text not null default 'resignation' check (kind in ('resignation','termination','retirement','end_of_contract','absconding')),
  requested_on        date not null default current_date,
  last_working_day    date not null,
  reason              text,
  status              text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn','completed')),
  approval_request_id uuid,
  exit_interview      jsonb,
  completed_at        timestamptz,
  created_by          uuid default app.uid(),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  check (last_working_day >= requested_on)
);
create unique index one_open_exit on public.exit_requests (employee_id) where status in ('pending','approved');
create table public.clearance_tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  exit_id     uuid not null,
  department  text not null,
  title       text not null,
  assignee_employee_id uuid,
  status      text not null default 'pending' check (status in ('pending','done','not_applicable')),
  remarks     text,
  done_at     timestamptz,
  foreign key (exit_id, org_id) references public.exit_requests (id, org_id) on delete cascade,
  foreign key (assignee_employee_id, org_id) references public.employees (id, org_id)
);

create or replace function app.submit_resignation(p_reason text, p_lwd date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; e public.employees%rowtype; notice integer; lwd date; xid uuid := gen_random_uuid(); steps jsonb; req uuid;
begin
  select * into me from app.current_employee();
  if me.employee_id is null then raise exception 'Not an employee' using errcode = '42501'; end if;
  if not app.module_enabled(me.org_id, 'offboarding') then raise exception 'The Offboarding module is not enabled'; end if;
  select * into e from public.employees where id = me.employee_id;
  if e.status not in ('active','on_notice') then raise exception 'Only an active employee can resign'; end if;
  select coalesce(j.notice_period_days, 30) into notice from public.employee_job_profile j where j.employee_id = e.id;
  notice := coalesce(notice, 30);
  lwd := coalesce(p_lwd, current_date + notice);
  if lwd < current_date then raise exception 'Last working day cannot be in the past'; end if;
  steps := case when e.reporting_manager_id is not null
    then jsonb_build_array(jsonb_build_object('type','manager','employee_id',e.reporting_manager_id,'sla_hours',48),
                           jsonb_build_object('type','hr','permission','offboarding.manage','sla_hours',48))
    else jsonb_build_array(jsonb_build_object('type','hr','permission','offboarding.manage','sla_hours',48)) end;
  insert into public.exit_requests (id, org_id, employee_id, kind, last_working_day, reason)
  values (xid, me.org_id, e.id, 'resignation', lwd, p_reason);
  req := app.create_approval(me.org_id, 'exit', xid, e.id, steps, jsonb_build_object('lwd', lwd, 'notice_days', notice));
  update public.exit_requests set approval_request_id = req where id = xid;
  return xid;
end $$;

create or replace function app.complete_exit(p_exit uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.exit_requests%rowtype;
begin
  select * into x from public.exit_requests where id = p_exit for update;
  if not found or not app.can(x.org_id, 'offboarding.manage') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if x.status <> 'approved' then raise exception 'Only an approved exit can be completed'; end if;
  if exists (select 1 from public.clearance_tasks where exit_id = p_exit and status = 'pending') then
    raise exception 'Clearance is incomplete';
  end if;
  if exists (select 1 from public.asset_allocations where employee_id = x.employee_id and returned_on is null) then
    raise exception 'Company assets have not been returned';
  end if;
  update public.exit_requests set status = 'completed', completed_at = now() where id = p_exit;
  update public.employees set status = 'exited', exit_date = coalesce(exit_date, x.last_working_day) where id = x.employee_id;
  update public.org_members set is_active = false where employee_id = x.employee_id and org_id = x.org_id and role <> 'owner';
  perform app.log_event(x.org_id, 'exit.completed', 'exit_request', p_exit::text, jsonb_build_object('employee_id', x.employee_id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Approval outcomes for the modules above
-- ---------------------------------------------------------------------------------------------
create or replace function app.approval_hook(p_type text, p_entity uuid, p_outcome text, p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.expense_claims%rowtype; x public.exit_requests%rowtype; pm text; adj uuid;
begin
  if p_type = 'expense' then
    select * into c from public.expense_claims where id = p_entity;
    update public.expense_claims set status = p_outcome where id = p_entity and status = 'submitted';
    if p_outcome = 'approved' and app.module_enabled(p_org, 'payroll') then
      pm := to_char(current_date, 'YYYY-MM');
      if exists (select 1 from public.pay_runs r where r.org_id = p_org and r.period_month = pm and r.status in ('approved','locked','paid') and r.run_type = 'regular') then
        pm := to_char(current_date + interval '1 month', 'YYYY-MM');
      end if;
      insert into public.pay_adjustments (org_id, employee_id, period_month, kind, description, amount, created_by)
      values (p_org, c.employee_id, pm, 'reimbursement', 'Expense claim ' || coalesce(c.claim_no, ''), c.total, null) returning id into adj;
      update public.expense_claims set payout_adjustment_id = adj where id = p_entity;
    end if;
  elsif p_type = 'exit' then
    select * into x from public.exit_requests where id = p_entity;
    update public.exit_requests set status = p_outcome where id = p_entity and status = 'pending';
    if p_outcome = 'approved' then
      update public.employees set status = 'on_notice', exit_date = x.last_working_day where id = x.employee_id;
      insert into public.employee_history (org_id, employee_id, effective_from, change_type, from_value, to_value, reason)
      values (p_org, x.employee_id, current_date, 'exit', jsonb_build_object('status', 'active'),
              jsonb_build_object('status', 'on_notice', 'last_working_day', x.last_working_day), x.reason);
      insert into public.clearance_tasks (org_id, exit_id, department, title)
      select p_org, x.id, d, t from (values ('Manager','Handover of work and knowledge transfer'), ('IT','Return laptop, access cards and revoke system access'),
             ('Admin','Return ID card, keys and other company property'), ('Finance','Clear advances, loans and expense claims'),
             ('HR','Exit interview and document collection')) v(d, t);
    end if;
  elsif p_type = 'requisition' then
    update public.job_requisitions set status = case p_outcome when 'approved' then 'open' else 'draft' end,
           opened_on = case p_outcome when 'approved' then current_date else opened_on end where id = p_entity and status = 'pending_approval';
  elsif p_type = 'offer' then
    update public.offers set status = case p_outcome when 'approved' then 'approved' else 'draft' end where id = p_entity and status = 'pending_approval';
  end if;
end $$;

-- When payroll consumes a reimbursement, the claim is marked paid.
create or replace function app.adjustment_applied() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'applied' and old.status = 'pending' then
    update public.expense_claims set status = 'paid' where payout_adjustment_id = new.id and status = 'approved';
  end if;
  return null;
end $$;
create trigger trg_adjustment_applied after update of status on public.pay_adjustments
  for each row execute function app.adjustment_applied();

create or replace function app.submit_requisition(p_req uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.job_requisitions%rowtype; ap uuid;
begin
  select * into r from public.job_requisitions where id = p_req for update;
  if not found or not app.can(r.org_id, 'recruitment.write') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r.status <> 'draft' then raise exception 'Requisition is already %', r.status; end if;
  ap := app.create_approval(r.org_id, 'requisition', r.id, app.my_employee_id(r.org_id),
        jsonb_build_array(jsonb_build_object('type','hr','permission','people.write','sla_hours',48)), jsonb_build_object('headcount', r.headcount));
  update public.job_requisitions set status = 'pending_approval', approval_request_id = ap where id = p_req;
  return ap;
end $$;

create or replace function app.submit_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.offers%rowtype; ap uuid;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or not app.can(o.org_id, 'recruitment.write') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if o.status <> 'draft' then raise exception 'Offer is already %', o.status; end if;
  ap := app.create_approval(o.org_id, 'offer', o.id, app.my_employee_id(o.org_id),
        jsonb_build_array(jsonb_build_object('type','hr','permission','people.write','sla_hours',24)), jsonb_build_object('annual_ctc', o.annual_ctc));
  update public.offers set status = 'pending_approval', approval_request_id = ap where id = p_offer;
  return ap;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['job_requisitions','candidates','interviews','offers','review_cycles','goals','reviews','recognitions',
    'helpdesk_categories','helpdesk_tickets','helpdesk_comments','assets','asset_allocations','expense_policies','expense_claims',
    'expense_items','exit_requests','clearance_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Recruitment: recruiters and HR; interviewers see only the candidates they interview
create policy req_select on public.job_requisitions for select to authenticated
  using (app.can(org_id, 'recruitment.read') or hiring_manager_id = app.my_employee_id(org_id));
create policy req_write on public.job_requisitions for all to authenticated
  using (app.can(org_id, 'recruitment.write') and status = 'draft') with check (app.can(org_id, 'recruitment.write'));
create policy cand_select on public.candidates for select to authenticated
  using (app.can(org_id, 'recruitment.read') or app.is_interviewer(id));
create policy cand_write on public.candidates for all to authenticated
  using (app.can(org_id, 'recruitment.write')) with check (app.can(org_id, 'recruitment.write'));
create policy interviews_select on public.interviews for select to authenticated
  using (app.can(org_id, 'recruitment.read') or interviewer_employee_id = app.my_employee_id(org_id));
create policy interviews_write on public.interviews for all to authenticated
  using (app.can(org_id, 'recruitment.write')) with check (app.can(org_id, 'recruitment.write'));
create policy interviews_feedback on public.interviews for update to authenticated
  using (interviewer_employee_id = app.my_employee_id(org_id)) with check (interviewer_employee_id = app.my_employee_id(org_id));
create policy offers_select on public.offers for select to authenticated using (app.can(org_id, 'recruitment.read'));
create policy offers_write on public.offers for all to authenticated
  using (app.can(org_id, 'recruitment.write') and status in ('draft','approved','sent')) with check (app.can(org_id, 'recruitment.write'));

-- Performance
create policy cycles_select on public.review_cycles for select to authenticated using (org_id in (select app.user_org_ids()));
create policy cycles_write on public.review_cycles for all to authenticated
  using (app.can(org_id, 'performance.admin')) with check (app.can(org_id, 'performance.admin'));
create policy goals_select on public.goals for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id) or app.can(org_id, 'performance.read'));
create policy goals_write_self on public.goals for all to authenticated
  using (employee_id = app.my_employee_id(org_id)) with check (employee_id = app.my_employee_id(org_id));
create policy goals_write_manager on public.goals for all to authenticated
  using (app.is_manager_of(employee_id) or app.can(org_id, 'performance.write'))
  with check (app.is_manager_of(employee_id) or app.can(org_id, 'performance.write'));
create policy reviews_select on public.reviews for select to authenticated
  using (reviewer_employee_id = app.my_employee_id(org_id)
         or app.can(org_id, 'performance.read')
         or (employee_id = app.my_employee_id(org_id) and (review_type = 'self' or (released and status = 'submitted')))
         or (app.is_manager_of(employee_id) and review_type = 'self'));
create policy reviews_write on public.reviews for insert to authenticated
  with check (reviewer_employee_id = app.my_employee_id(org_id)
              and (review_type = 'self' and employee_id = reviewer_employee_id or app.is_manager_of(employee_id) or app.can(org_id, 'performance.write'))
              and released = false);
create policy reviews_update on public.reviews for update to authenticated
  using (reviewer_employee_id = app.my_employee_id(org_id) and status = 'draft')
  with check (reviewer_employee_id = app.my_employee_id(org_id) and released = false);
create policy reviews_release on public.reviews for update to authenticated
  using (app.can(org_id, 'performance.admin')) with check (app.can(org_id, 'performance.admin'));
create policy recog_select on public.recognitions for select to authenticated
  using (is_public and org_id in (select app.user_org_ids())
         or from_employee_id = app.my_employee_id(org_id) or to_employee_id = app.my_employee_id(org_id));
create policy recog_insert on public.recognitions for insert to authenticated
  with check (from_employee_id = app.my_employee_id(org_id));

-- Helpdesk
create policy hd_cat_select on public.helpdesk_categories for select to authenticated using (org_id in (select app.user_org_ids()));
create policy hd_cat_write on public.helpdesk_categories for all to authenticated
  using (app.can(org_id, 'helpdesk.manage')) with check (app.can(org_id, 'helpdesk.manage'));
create policy hd_select on public.helpdesk_tickets for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.can(org_id, 'helpdesk.read') or assigned_to = app.my_employee_id(org_id));
create policy hd_insert on public.helpdesk_tickets for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and status = 'open' and assigned_to is null);
create policy hd_manage on public.helpdesk_tickets for update to authenticated
  using (app.can(org_id, 'helpdesk.manage') or assigned_to = app.my_employee_id(org_id))
  with check (app.can(org_id, 'helpdesk.manage') or assigned_to = app.my_employee_id(org_id));
create policy hd_comment_select on public.helpdesk_comments for select to authenticated
  using (app.can(org_id, 'helpdesk.read')
         or (not is_internal and exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id and t.employee_id = app.my_employee_id(t.org_id))));
create policy hd_comment_insert on public.helpdesk_comments for insert to authenticated
  with check ((author_id = app.uid())
              and (app.can(org_id, 'helpdesk.manage')
                   or (not is_internal and exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id and t.employee_id = app.my_employee_id(t.org_id)))));

-- Assets
create policy assets_select on public.assets for select to authenticated using (app.can(org_id, 'assets.read'));
create policy assets_write on public.assets for all to authenticated
  using (app.can(org_id, 'assets.manage')) with check (app.can(org_id, 'assets.manage'));
create policy alloc_select on public.asset_allocations for select to authenticated
  using (app.can(org_id, 'assets.read') or employee_id = app.my_employee_id(org_id));
create policy alloc_write on public.asset_allocations for all to authenticated
  using (app.can(org_id, 'assets.manage')) with check (app.can(org_id, 'assets.manage'));
create policy alloc_ack on public.asset_allocations for update to authenticated
  using (employee_id = app.my_employee_id(org_id)) with check (employee_id = app.my_employee_id(org_id) and returned_on is null);

-- Expenses
create policy exp_pol_select on public.expense_policies for select to authenticated using (org_id in (select app.user_org_ids()));
create policy exp_pol_write on public.expense_policies for all to authenticated
  using (app.can(org_id, 'settings.write')) with check (app.can(org_id, 'settings.write'));
create policy claims_select on public.expense_claims for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id) or app.can(org_id, 'expenses.read'));
create policy claims_insert on public.expense_claims for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and status = 'draft');
create policy claims_update_draft on public.expense_claims for update to authenticated
  using (employee_id = app.my_employee_id(org_id) and status = 'draft')
  with check (employee_id = app.my_employee_id(org_id) and status = 'draft');
create policy claims_delete_draft on public.expense_claims for delete to authenticated
  using (employee_id = app.my_employee_id(org_id) and status = 'draft');
create policy items_select_exp on public.expense_items for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id
                 and (c.employee_id = app.my_employee_id(c.org_id) or app.is_manager_of(c.employee_id) or app.can(c.org_id, 'expenses.read'))));
create policy items_write_exp on public.expense_items for all to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = app.my_employee_id(c.org_id)))
  with check (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = app.my_employee_id(c.org_id)));

-- Offboarding
create policy exit_select on public.exit_requests for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id) or app.can(org_id, 'offboarding.read'));
create policy exit_write on public.exit_requests for update to authenticated
  using (app.can(org_id, 'offboarding.manage')) with check (app.can(org_id, 'offboarding.manage'));
create policy clear_select on public.clearance_tasks for select to authenticated
  using (app.can(org_id, 'offboarding.read') or assignee_employee_id = app.my_employee_id(org_id)
         or exists (select 1 from public.exit_requests x where x.id = exit_id and x.employee_id = app.my_employee_id(x.org_id)));
create policy clear_write on public.clearance_tasks for update to authenticated
  using (app.can(org_id, 'offboarding.manage') or assignee_employee_id = app.my_employee_id(org_id))
  with check (app.can(org_id, 'offboarding.manage') or assignee_employee_id = app.my_employee_id(org_id));

-- Module gates (entitlements are enforced in the database, not just hidden in the menu)
create trigger trg_gate_recruit1 before insert on public.job_requisitions for each row execute function app.require_module('recruitment');
create trigger trg_gate_recruit2 before insert on public.candidates       for each row execute function app.require_module('recruitment');
create trigger trg_gate_perf1    before insert on public.review_cycles    for each row execute function app.require_module('performance');
create trigger trg_gate_perf2    before insert on public.goals            for each row execute function app.require_module('performance');
create trigger trg_gate_help     before insert on public.helpdesk_tickets for each row execute function app.require_module('helpdesk');
create trigger trg_gate_assets   before insert on public.assets           for each row execute function app.require_module('assets');
create trigger trg_gate_expense  before insert on public.expense_claims   for each row execute function app.require_module('expenses');
create trigger trg_gate_payroll1 before insert on public.salary_structures for each row execute function app.require_module('payroll');
create trigger trg_gate_payroll2 before insert on public.employee_compensation for each row execute function app.require_module('payroll');
create trigger trg_gate_payroll3 before insert on public.pay_adjustments  for each row execute function app.require_module('payroll');
create trigger trg_gate_payroll4 before insert on public.loans            for each row execute function app.require_module('loans');
create trigger trg_gate_stat     before insert on public.statutory_filings for each row execute function app.require_module('statutory');

-- Audit
create trigger trg_audit_requisitions after insert or update or delete on public.job_requisitions for each row execute function app.audit_row();
create trigger trg_audit_offers       after insert or update or delete on public.offers for each row execute function app.audit_row();
create trigger trg_audit_reviews      after insert or update or delete on public.reviews for each row execute function app.audit_row();
create trigger trg_audit_assets       after insert or update or delete on public.assets for each row execute function app.audit_row();
create trigger trg_audit_alloc        after insert or update or delete on public.asset_allocations for each row execute function app.audit_row();
create trigger trg_audit_claims       after insert or update or delete on public.expense_claims for each row execute function app.audit_row();
create trigger trg_audit_exits        after insert or update or delete on public.exit_requests for each row execute function app.audit_row();
create trigger trg_audit_candidates   after update or delete on public.candidates for each row execute function app.audit_row();
