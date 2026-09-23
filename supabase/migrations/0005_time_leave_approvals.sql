-- Organisation settings, attendance, holidays, leave (ledger based) and the multi-level approval engine.

create table public.org_settings (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  weekly_offs            integer[] not null default '{0}',                       -- 0 = Sunday ... 6 = Saturday
  leave_year_start_month integer not null default 1 check (leave_year_start_month between 1 and 12),
  -- attendance
  selfie_mandatory       boolean not null default true,
  geofence_mandatory     boolean not null default true,
  allow_wfh              boolean not null default true,
  ip_restriction         boolean not null default false,
  allowed_ips            text[] not null default '{}',
  reject_mock_location   boolean not null default true,
  -- payroll
  wage_definition        text not null default 'labour_code' check (wage_definition in ('labour_code','legacy_basic_da')),
  esi_includes_overtime  boolean not null default true,
  payroll_day_basis      text not null default 'calendar' check (payroll_day_basis in ('calendar','26','30')),
  payroll_maker_checker  boolean not null default true,
  pf_on_actual_default   boolean not null default false,
  updated_at             timestamptz not null default now()
);
create trigger trg_org_settings_touch before update on public.org_settings
  for each row execute function app.touch_updated_at();

alter table public.departments add column head_employee_id uuid;
alter table public.departments add constraint departments_head_fk
  foreign key (head_employee_id, org_id) references public.employees (id, org_id);

-- ---------------------------------------------------------------------------------------------
-- Shifts, devices, holidays
-- ---------------------------------------------------------------------------------------------
create table public.shifts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  name              text not null,
  start_time        time not null,
  end_time          time not null,
  grace_minutes     integer not null default 15 check (grace_minutes >= 0),
  half_day_minutes  integer not null default 240,
  full_day_minutes  integer not null default 480,
  is_default        boolean not null default false,
  unique (id, org_id),
  unique (org_id, name)
);
create unique index shifts_one_default on public.shifts (org_id) where is_default;

create table public.employee_shifts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  employee_id    uuid not null,
  shift_id       uuid not null,
  effective_from date not null,
  effective_to   date,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (shift_id, org_id) references public.shifts (id, org_id),
  check (effective_to is null or effective_to >= effective_from)
);
create index on public.employee_shifts (org_id, employee_id, effective_from desc);

create table public.attendance_devices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  device_type  text not null check (device_type in ('biometric','face','rfid','kiosk')),
  vendor       text not null default 'other' check (vendor in ('essl','matrix','zkteco','realtime','other')),
  serial_no    text not null,
  location_id  uuid,
  status       text not null default 'unknown' check (status in ('online','offline','unknown')),
  last_sync_at timestamptz,
  config       jsonb not null default '{}'::jsonb,        -- never store device passwords here
  unique (id, org_id),
  unique (org_id, serial_no),
  foreign key (location_id, org_id) references public.locations (id, org_id)
);

create table public.holidays (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  holiday_date  date not null,
  name          text not null,
  is_optional   boolean not null default false,
  location_id   uuid,
  foreign key (location_id, org_id) references public.locations (id, org_id)
);
create unique index holidays_unique on public.holidays (org_id, holiday_date, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------------------------
-- Attendance. Raw punches are append-only; corrections go through regularisation.
-- ---------------------------------------------------------------------------------------------
create table public.attendance_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  employee_id       uuid not null,
  event_time        timestamptz not null,
  event_type        text not null check (event_type in ('in','out')),
  source            text not null check (source in ('mobile_selfie','biometric','web','manual','kiosk')),
  lat               numeric(9,6),
  lng               numeric(9,6),
  accuracy_m        numeric(8,2),
  inside_geofence   boolean,
  distance_m        numeric(10,2),
  selfie_path       text,
  device_id         uuid,
  ip                inet,
  is_mock_location  boolean not null default false,
  device_fingerprint text,
  client_event_id   uuid,                               -- idempotency key for offline sync
  flags             text[] not null default '{}',
  created_by        uuid,
  created_at        timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (device_id, org_id) references public.attendance_devices (id, org_id),
  unique (org_id, client_event_id)
);
create index on public.attendance_events (org_id, employee_id, event_time);
-- Server-side truth for punches: the client only reports coordinates. Distance and geofence result are
-- computed here from the employee's work location, and the row is stamped with the caller.
create or replace function app.attendance_event_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  loc public.locations%rowtype;
  d numeric;
begin
  new.created_by := coalesce(app.uid(), new.created_by);
  new.created_at := now();
  new.inside_geofence := null;
  new.distance_m := null;
  select l.* into loc from public.employees e join public.locations l on l.id = e.location_id
   where e.id = new.employee_id;
  if found and loc.lat is not null and loc.lng is not null and new.lat is not null and new.lng is not null then
    -- haversine, metres
    d := 2 * 6371000 * asin(sqrt(
           power(sin(radians(new.lat - loc.lat) / 2), 2) +
           cos(radians(loc.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - loc.lng) / 2), 2)));
    new.distance_m := round(d, 2);
    new.inside_geofence := d <= coalesce(loc.geofence_radius_m, 200);
    if not new.inside_geofence then new.flags := array_append(new.flags, 'outside_geofence'); end if;
  end if;
  if new.is_mock_location then new.flags := array_append(new.flags, 'mock_location'); end if;
  return new;
end $$;
create trigger trg_attendance_event_before before insert on public.attendance_events
  for each row execute function app.attendance_event_before();

create trigger trg_attendance_events_immutable before update or delete on public.attendance_events
  for each row when (current_setting('app.allow_attendance_edit', true) is distinct from 'on')
  execute function app.deny_modification();

create table public.attendance_daily (
  org_id          uuid not null,
  employee_id     uuid not null,
  work_date       date not null,
  shift_id        uuid,
  first_in        timestamptz,
  last_out        timestamptz,
  worked_minutes  integer not null default 0,
  status          text not null check (status in ('present','late','half_day','absent','wfh','leave','holiday','weekly_off','on_duty')),
  late_minutes    integer not null default 0,
  overtime_minutes integer not null default 0,
  source          text,
  is_regularized  boolean not null default false,
  locked          boolean not null default false,        -- locked once payroll for the month is approved
  updated_at      timestamptz not null default now(),
  primary key (employee_id, work_date),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.attendance_daily (org_id, work_date);

-- ---------------------------------------------------------------------------------------------
-- Leave: types, ledger (source of truth for balances), requests
-- ---------------------------------------------------------------------------------------------
create table public.leave_types (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  code                     text not null,                 -- CL, SL, EL, CO, LWP, OD
  name                     text not null,
  is_paid                  boolean not null default true,
  days_per_year            numeric(5,1) not null default 0,
  accrual                  text not null default 'yearly' check (accrual in ('yearly','monthly','none')),
  carry_forward            boolean not null default false,
  carry_max                numeric(5,1) not null default 0,
  encashable               boolean not null default false,
  probation_days           integer not null default 0,    -- not usable until this many days after joining
  half_day_allowed         boolean not null default true,
  doc_required_after_days  numeric(4,1),
  gender_specific          text check (gender_specific in ('M','F')),
  grade_codes              text[] not null default '{}',   -- empty = all grades
  auto_approve             boolean not null default false,
  approval_levels          integer not null default 2 check (approval_levels between 0 and 3),
  dept_head_after_days     numeric(4,1) default 5,
  allow_negative           boolean not null default false,
  is_active                boolean not null default true,
  unique (id, org_id),
  unique (org_id, code)
);

create table public.leave_ledger (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  employee_id    uuid not null,
  leave_type_id  uuid not null,
  entry_date     date not null,
  leave_year     integer not null,
  delta          numeric(6,1) not null,
  reason         text not null check (reason in ('opening','accrual','leave_taken','reversal','carry_forward','encashment','adjustment','lapse')),
  ref_id         uuid,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (leave_type_id, org_id) references public.leave_types (id, org_id)
);
create index on public.leave_ledger (org_id, employee_id, leave_type_id, leave_year);
create trigger trg_leave_ledger_immutable before update or delete on public.leave_ledger
  for each row execute function app.deny_modification();

create or replace view public.leave_balances with (security_invoker = true) as
  select org_id, employee_id, leave_type_id, leave_year,
         sum(delta) as balance,
         sum(delta) filter (where reason in ('opening','accrual','carry_forward','adjustment')) as credited,
         -sum(delta) filter (where reason in ('leave_taken','reversal','encashment','lapse')) as debited
  from public.leave_ledger
  group by org_id, employee_id, leave_type_id, leave_year;

create table public.leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  request_no          text,
  employee_id         uuid not null,
  leave_type_id       uuid not null,
  from_date           date not null,
  to_date             date not null,
  half_day            text not null default 'none' check (half_day in ('none','first','second')),
  days                numeric(4,1) not null check (days > 0),
  reason              text,
  document_path       text,
  status              text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  balance_before      numeric(6,1),
  balance_after       numeric(6,1),
  approval_request_id uuid,
  applied_at          timestamptz not null default now(),
  decided_at          timestamptz,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (leave_type_id, org_id) references public.leave_types (id, org_id),
  check (to_date >= from_date)
);
create index on public.leave_requests (org_id, employee_id, from_date);
create index on public.leave_requests (org_id, status);

create table public.attendance_regularizations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  employee_id         uuid not null,
  work_date           date not null,
  request_type        text not null check (request_type in ('missed_in','missed_out','wrong_punch','wfh','on_duty')),
  requested_in        timestamptz,
  requested_out       timestamptz,
  reason              text not null check (length(reason) >= 3),
  status              text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approval_request_id uuid,
  created_at          timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.attendance_regularizations (org_id, employee_id, work_date);

-- ---------------------------------------------------------------------------------------------
-- Approval engine: any request becomes an ordered list of steps; each step names an approver.
-- ---------------------------------------------------------------------------------------------
create table public.approval_requests (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  entity_type           text not null check (entity_type in ('leave','regularization','profile_change','expense','loan','exit','requisition','offer','other')),
  entity_id             uuid not null,
  requester_employee_id uuid not null,
  status                text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  current_level         integer not null default 1,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  decided_at            timestamptz,
  unique (id, org_id),
  foreign key (requester_employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.approval_requests (org_id, status);
create index on public.approval_requests (org_id, entity_type, entity_id);

create table public.approval_steps (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  request_id           uuid not null,
  level                integer not null,
  approver_type        text not null check (approver_type in ('manager','hr','dept_head','employee','finance')),
  approver_employee_id uuid,                      -- set for manager / dept_head / employee steps
  approver_permission  text,                      -- set for role based steps, e.g. leave.approve
  status               text not null default 'pending' check (status in ('pending','approved','rejected','skipped','forwarded')),
  acted_by             uuid,
  acted_at             timestamptz,
  comment              text,
  due_at               timestamptz,
  foreign key (request_id, org_id) references public.approval_requests (id, org_id) on delete cascade,
  foreign key (approver_employee_id, org_id) references public.employees (id, org_id),
  unique (request_id, level)
);
create index on public.approval_steps (org_id, approver_employee_id) where status = 'pending';

create table public.approval_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  request_id  uuid not null,
  level       integer,
  actor_user  uuid,
  action      text not null check (action in ('submit','approve','reject','forward','comment','cancel','auto_escalate')),
  comment     text,
  created_at  timestamptz not null default now(),
  foreign key (request_id, org_id) references public.approval_requests (id, org_id) on delete cascade
);
create trigger trg_approval_actions_immutable before update or delete on public.approval_actions
  for each row execute function app.deny_modification();

-- ---------------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------------

-- Working days in a range, excluding weekly offs and non-optional holidays.
create or replace function app.leave_days(org uuid, d_from date, d_to date, half text default 'none')
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  offs integer[] := coalesce((select weekly_offs from public.org_settings where org_id = org), '{0}');
  n numeric;
begin
  select count(*) into n
  from generate_series(d_from, d_to, interval '1 day') g(d)
  where not (extract(dow from g.d)::int = any (offs))
    and not exists (select 1 from public.holidays h where h.org_id = org and h.holiday_date = g.d::date and not h.is_optional);
  if half <> 'none' and d_from = d_to and n > 0 then return 0.5; end if;
  return n;
end $$;

create or replace function app.leave_balance(emp uuid, ltype uuid, yr integer) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(delta), 0) from public.leave_ledger where employee_id = emp and leave_type_id = ltype and leave_year = yr
$$;

create or replace function app.create_approval(p_org uuid, p_type text, p_entity uuid, p_requester uuid, p_steps jsonb, p_payload jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req uuid;
  s jsonb;
  lvl integer := 0;
begin
  insert into public.approval_requests (org_id, entity_type, entity_id, requester_employee_id, payload)
  values (p_org, p_type, p_entity, p_requester, p_payload) returning id into req;
  for s in select * from jsonb_array_elements(p_steps) loop
    lvl := lvl + 1;
    insert into public.approval_steps (org_id, request_id, level, approver_type, approver_employee_id, approver_permission, due_at)
    values (p_org, req, lvl, s ->> 'type', nullif(s ->> 'employee_id', '')::uuid, s ->> 'permission',
            now() + make_interval(hours => coalesce((s ->> 'sla_hours')::int, 48)));
  end loop;
  insert into public.approval_actions (org_id, request_id, level, actor_user, action) values (p_org, req, 0, app.uid(), 'submit');
  return req;
end $$;

-- Apply for leave. Enforces balance, probation, gender, document, overlap and builds the approval chain.
create or replace function app.apply_leave(p_type uuid, p_from date, p_to date, p_half text default 'none', p_reason text default null, p_doc text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lt public.leave_types%rowtype;
  emp uuid;
  e public.employees%rowtype;
  v_gender text;
  n numeric;
  bal numeric;
  pending_days numeric;
  yr integer := extract(year from p_from)::int;
  lr uuid := gen_random_uuid();
  mgr uuid;
  mgr_on_leave boolean;
  steps jsonb := '[]'::jsonb;
  req uuid;
  head uuid;
begin
  select * into lt from public.leave_types where id = p_type and is_active;
  if not found then raise exception 'Unknown leave type'; end if;
  emp := app.my_employee_id(lt.org_id);
  if emp is null then raise exception 'Not an employee of this organisation' using errcode = '42501'; end if;
  select * into e from public.employees where id = emp;
  if p_to < p_from then raise exception 'To date is before from date'; end if;
  if p_half <> 'none' and (p_from <> p_to or not lt.half_day_allowed) then raise exception 'Half day is not allowed for this request'; end if;
  if lt.probation_days > 0 and (p_from - e.doj) < lt.probation_days then
    raise exception 'PROBATION: % leave is available after % days of service', lt.code, lt.probation_days;
  end if;
  select p.gender into v_gender from public.employee_personal p where p.employee_id = emp;
  if lt.gender_specific is not null and v_gender is distinct from lt.gender_specific then
    raise exception 'GENDER: % leave is not applicable', lt.code;
  end if;
  n := app.leave_days(lt.org_id, p_from, p_to, p_half);
  if n <= 0 then raise exception 'The selected dates are all weekly offs or holidays'; end if;
  if lt.doc_required_after_days is not null and n > lt.doc_required_after_days and coalesce(p_doc, '') = '' then
    raise exception 'DOCUMENT: a supporting document is required for more than % days', lt.doc_required_after_days;
  end if;
  if exists (select 1 from public.leave_requests r where r.employee_id = emp and r.status in ('pending','approved')
             and daterange(r.from_date, r.to_date, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'OVERLAP: you already have leave in this period';
  end if;
  bal := app.leave_balance(emp, p_type, yr);
  select coalesce(sum(days), 0) into pending_days from public.leave_requests
    where employee_id = emp and leave_type_id = p_type and status = 'pending' and extract(year from from_date)::int = yr;
  if lt.is_paid and not lt.allow_negative and n > bal - pending_days then
    raise exception 'BALANCE: requested % day(s), available %', n, bal - pending_days;
  end if;

  -- approval chain: manager, then HR, then department head for long leave
  mgr := e.reporting_manager_id;
  if mgr is not null then
    select exists (select 1 from public.leave_requests r where r.employee_id = mgr and r.status = 'approved'
                   and p_from between r.from_date and r.to_date) into mgr_on_leave;
    if mgr_on_leave then
      steps := steps || jsonb_build_array(jsonb_build_object('type','hr','permission','leave.approve','sla_hours',24));  -- auto-escalation when the manager is away
    else
      steps := steps || jsonb_build_array(jsonb_build_object('type','manager','employee_id',mgr,'sla_hours',24));
    end if;
  end if;
  if lt.approval_levels >= 2 and not lt.auto_approve then
    steps := steps || jsonb_build_array(jsonb_build_object('type','hr','permission','leave.approve','sla_hours',48));
  end if;
  if lt.approval_levels >= 3 and lt.dept_head_after_days is not null and n > lt.dept_head_after_days then
    select d.head_employee_id into head from public.departments d where d.id = e.department_id;
    if head is not null and head <> emp then
      steps := steps || jsonb_build_array(jsonb_build_object('type','dept_head','employee_id',head,'sla_hours',48));
    end if;
  end if;
  if jsonb_array_length(steps) = 0 then
    steps := jsonb_build_array(jsonb_build_object('type','hr','permission','leave.approve','sla_hours',48));
  end if;

  insert into public.leave_requests (id, org_id, employee_id, leave_type_id, from_date, to_date, half_day, days, reason, document_path, balance_before, balance_after)
  values (lr, lt.org_id, emp, p_type, p_from, p_to, p_half, n, p_reason, p_doc, bal, bal - n);
  req := app.create_approval(lt.org_id, 'leave', lr, emp, steps, jsonb_build_object('days', n, 'type', lt.code));
  update public.leave_requests set approval_request_id = req, request_no = 'LV-' || lpad((select count(*) from public.leave_requests where org_id = lt.org_id)::text, 4, '0') where id = lr;

  if lt.auto_approve then
    perform app.finalize_approval(req, 'approved');
  end if;
  return lr;
end $$;

-- Other modules react to a finished approval here (expenses, exits, requisitions, offers). Replaced in 0007.
create or replace function app.approval_hook(p_type text, p_entity uuid, p_outcome text, p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  null;
end $$;

create or replace function app.finalize_approval(req uuid, outcome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.approval_requests%rowtype;
  lr public.leave_requests%rowtype;
  rg public.attendance_regularizations%rowtype;
  d date;
begin
  select * into r from public.approval_requests where id = req;
  update public.approval_requests set status = outcome, decided_at = now() where id = req;
  if r.entity_type = 'leave' then
    select * into lr from public.leave_requests where id = r.entity_id;
    update public.leave_requests set status = outcome, decided_at = now() where id = lr.id;
    if outcome = 'approved' then
      insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year, delta, reason, ref_id, created_by)
      values (lr.org_id, lr.employee_id, lr.leave_type_id, lr.from_date, extract(year from lr.from_date)::int, -lr.days, 'leave_taken', lr.id, app.uid());
      for d in select g::date from generate_series(lr.from_date, lr.to_date, interval '1 day') g loop
        if app.leave_days(lr.org_id, d, d) > 0 then
          insert into public.attendance_daily (org_id, employee_id, work_date, status, source)
          values (lr.org_id, lr.employee_id, d, 'leave', 'leave')
          on conflict (employee_id, work_date) do update set status = 'leave' where public.attendance_daily.first_in is null and not public.attendance_daily.locked;
        end if;
      end loop;
    end if;
  elsif r.entity_type = 'regularization' then
    select * into rg from public.attendance_regularizations where id = r.entity_id;
    update public.attendance_regularizations set status = outcome where id = rg.id;
    if outcome = 'approved' then
      insert into public.attendance_daily (org_id, employee_id, work_date, first_in, last_out, worked_minutes, status, source, is_regularized)
      values (rg.org_id, rg.employee_id, rg.work_date, rg.requested_in, rg.requested_out,
              coalesce(extract(epoch from (rg.requested_out - rg.requested_in))::int / 60, 0),
              case when rg.request_type = 'wfh' then 'wfh' when rg.request_type = 'on_duty' then 'on_duty' else 'present' end,
              'manual', true)
      on conflict (employee_id, work_date) do update
        set first_in = excluded.first_in, last_out = excluded.last_out, worked_minutes = excluded.worked_minutes,
            status = excluded.status, is_regularized = true, updated_at = now()
        where not public.attendance_daily.locked;
    end if;
  end if;
  perform app.approval_hook(r.entity_type, r.entity_id, outcome, r.org_id);
  insert into public.audit_logs (org_id, actor_id, action, entity_type, entity_id, detail)
  values (r.org_id, app.uid(), 'approval.' || outcome, r.entity_type, r.entity_id::text, jsonb_build_object('request_id', req));
end $$;

create or replace function app.decide_approval(req uuid, decision text, p_comment text default null, p_forward_to uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.approval_requests%rowtype;
  s public.approval_steps%rowtype;
  me uuid;
  ok boolean := false;
  nxt integer;
begin
  if decision not in ('approve','reject','forward') then raise exception 'Invalid decision %', decision; end if;
  select * into r from public.approval_requests where id = req for update;
  if not found or r.status <> 'pending' then raise exception 'Request is not pending'; end if;
  select * into s from public.approval_steps where request_id = req and level = r.current_level and status = 'pending';
  if not found then raise exception 'No pending step'; end if;
  me := app.my_employee_id(r.org_id);
  if me is not null and me = r.requester_employee_id then
    raise exception 'You cannot decide your own request' using errcode = '42501';
  end if;
  if s.approver_employee_id is not null and s.approver_employee_id = me then ok := true; end if;
  if not ok and s.approver_permission is not null and app.can(r.org_id, s.approver_permission) then ok := true; end if;
  if not ok then raise exception 'You are not the approver for this step' using errcode = '42501'; end if;

  if decision = 'forward' then
    if p_forward_to is null then raise exception 'forward_to is required'; end if;
    update public.approval_steps set status = 'forwarded', acted_by = app.uid(), acted_at = now(), comment = p_comment
     where id = s.id;
    insert into public.approval_steps (org_id, request_id, level, approver_type, approver_employee_id, due_at)
    select r.org_id, req, coalesce(max(level), 0) + 1, 'employee', p_forward_to, now() + interval '48 hours' from public.approval_steps where request_id = req;
    -- shift later steps up so the forwarded step runs next
    update public.approval_requests set current_level = (select max(level) from public.approval_steps where request_id = req) where id = req;
    insert into public.approval_actions (org_id, request_id, level, actor_user, action, comment) values (r.org_id, req, s.level, app.uid(), 'forward', p_comment);
    return 'forwarded';
  end if;

  update public.approval_steps set status = case decision when 'approve' then 'approved' else 'rejected' end,
         acted_by = app.uid(), acted_at = now(), comment = p_comment where id = s.id;
  insert into public.approval_actions (org_id, request_id, level, actor_user, action, comment) values (r.org_id, req, s.level, app.uid(), decision, p_comment);

  if decision = 'reject' then
    perform app.finalize_approval(req, 'rejected');
    return 'rejected';
  end if;
  select min(level) into nxt from public.approval_steps where request_id = req and status = 'pending';
  if nxt is null then
    perform app.finalize_approval(req, 'approved');
    return 'approved';
  end if;
  update public.approval_requests set current_level = nxt where id = req;
  return 'pending';
end $$;

create or replace function app.cancel_leave(p_leave uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare lr public.leave_requests%rowtype;
begin
  select * into lr from public.leave_requests where id = p_leave;
  if not found or lr.employee_id is distinct from app.my_employee_id(lr.org_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if lr.status not in ('pending','approved') then raise exception 'Leave is already %', lr.status; end if;
  if lr.status = 'approved' then
    insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year, delta, reason, ref_id, created_by)
    values (lr.org_id, lr.employee_id, lr.leave_type_id, current_date, extract(year from lr.from_date)::int, lr.days, 'reversal', lr.id, app.uid());
    delete from public.attendance_daily where employee_id = lr.employee_id and work_date between lr.from_date and lr.to_date
      and status = 'leave' and first_in is null and not locked;
  end if;
  update public.leave_requests set status = 'cancelled', decided_at = now() where id = p_leave;
  update public.approval_requests set status = 'cancelled', decided_at = now() where id = lr.approval_request_id and status = 'pending';
end $$;

create or replace function app.request_regularization(p_date date, p_type text, p_in timestamptz, p_out timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  emp uuid;
  org uuid;
  e public.employees%rowtype;
  rid uuid := gen_random_uuid();
  steps jsonb;
begin
  select org_id, employee_id into org, emp from public.org_members where user_id = app.uid() and is_active and employee_id is not null limit 1;
  if emp is null then raise exception 'Not an employee' using errcode = '42501'; end if;
  select * into e from public.employees where id = emp;
  if p_date > current_date then raise exception 'Cannot regularise a future date'; end if;
  if p_date < current_date - 31 then raise exception 'Regularisation window is 31 days'; end if;
  steps := case when e.reporting_manager_id is not null
    then jsonb_build_array(jsonb_build_object('type','manager','employee_id',e.reporting_manager_id,'sla_hours',24))
    else jsonb_build_array(jsonb_build_object('type','hr','permission','attendance.approve','sla_hours',24)) end;
  insert into public.attendance_regularizations (id, org_id, employee_id, work_date, request_type, requested_in, requested_out, reason)
  values (rid, org, emp, p_date, p_type, p_in, p_out, p_reason);
  update public.attendance_regularizations set approval_request_id = app.create_approval(org, 'regularization', rid, emp, steps) where id = rid;
  return rid;
end $$;

-- Recompute one employee-day from raw punches.
create or replace function app.recompute_attendance_day(emp uuid, d date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.employees%rowtype;
  tz text;
  sh public.shifts%rowtype;
  fi timestamptz;
  lo timestamptz;
  mins integer;
  late integer := 0;
  st text;
  src text;
  shift_start timestamptz;
begin
  select * into e from public.employees where id = emp;
  select timezone into tz from public.organizations where id = e.org_id;
  select s.* into sh from public.employee_shifts es join public.shifts s on s.id = es.shift_id
   where es.employee_id = emp and es.effective_from <= d and (es.effective_to is null or es.effective_to >= d)
   order by es.effective_from desc limit 1;
  if not found then select * into sh from public.shifts where org_id = e.org_id and is_default; end if;
  select min(event_time) filter (where event_type = 'in'), max(event_time) filter (where event_type = 'out'), min(source)
    into fi, lo, src
    from public.attendance_events
   where employee_id = emp and (event_time at time zone tz)::date = d;
  if fi is null and lo is null then return; end if;
  fi := coalesce(fi, lo);
  mins := case when lo is not null and lo > fi then (extract(epoch from (lo - fi)) / 60)::int else 0 end;
  if sh.id is not null then
    shift_start := ((d::text || ' ' || sh.start_time::text)::timestamp at time zone tz);
    late := greatest(0, (extract(epoch from (fi - shift_start)) / 60)::int - sh.grace_minutes);
    st := case when lo is null then case when late > 0 then 'late' else 'present' end
               when mins >= sh.full_day_minutes then case when late > 0 then 'late' else 'present' end
               when mins >= sh.half_day_minutes then 'half_day'
               else 'half_day' end;
  else
    st := 'present';
  end if;
  insert into public.attendance_daily (org_id, employee_id, work_date, shift_id, first_in, last_out, worked_minutes, status, late_minutes, source)
  values (e.org_id, emp, d, sh.id, fi, lo, mins, st, late, src)
  on conflict (employee_id, work_date) do update
    set first_in = excluded.first_in, last_out = excluded.last_out, worked_minutes = excluded.worked_minutes,
        status = excluded.status, late_minutes = excluded.late_minutes, source = excluded.source, updated_at = now()
    where not public.attendance_daily.locked and not public.attendance_daily.is_regularized;
end $$;

create or replace function app.attendance_event_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tz text;
begin
  select timezone into tz from public.organizations where id = new.org_id;
  perform app.recompute_attendance_day(new.employee_id, (new.event_time at time zone tz)::date);
  return null;
end $$;
create trigger trg_attendance_event_after after insert on public.attendance_events
  for each row execute function app.attendance_event_after();

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.org_settings               enable row level security;
alter table public.shifts                     enable row level security;
alter table public.employee_shifts            enable row level security;
alter table public.attendance_devices         enable row level security;
alter table public.holidays                   enable row level security;
alter table public.attendance_events          enable row level security;
alter table public.attendance_daily           enable row level security;
alter table public.leave_types                enable row level security;
alter table public.leave_ledger               enable row level security;
alter table public.leave_requests             enable row level security;
alter table public.attendance_regularizations enable row level security;
alter table public.approval_requests          enable row level security;
alter table public.approval_steps             enable row level security;
alter table public.approval_actions           enable row level security;

create policy org_settings_select on public.org_settings for select to authenticated using (org_id in (select app.user_org_ids()));
create policy org_settings_write on public.org_settings for all to authenticated
  using (app.can(org_id, 'settings.write')) with check (app.can(org_id, 'settings.write'));

create policy shifts_select on public.shifts for select to authenticated using (org_id in (select app.user_org_ids()));
create policy shifts_write on public.shifts for all to authenticated
  using (app.can(org_id, 'attendance.write')) with check (app.can(org_id, 'attendance.write'));
create policy emp_shifts_select on public.employee_shifts for select to authenticated
  using (app.can(org_id, 'attendance.read') or employee_id = app.my_employee_id(org_id));
create policy emp_shifts_write on public.employee_shifts for all to authenticated
  using (app.can(org_id, 'attendance.write')) with check (app.can(org_id, 'attendance.write'));
create policy devices_select on public.attendance_devices for select to authenticated using (app.can(org_id, 'attendance.read'));
create policy devices_write on public.attendance_devices for all to authenticated
  using (app.can(org_id, 'attendance.write')) with check (app.can(org_id, 'attendance.write'));
create policy holidays_select on public.holidays for select to authenticated using (org_id in (select app.user_org_ids()));
create policy holidays_write on public.holidays for all to authenticated
  using (app.can(org_id, 'leave.config')) with check (app.can(org_id, 'leave.config'));

-- Punches: own, manager's team, or HR. Employees may add their own punch for "now" only.
create policy events_select on public.attendance_events for select to authenticated
  using (app.can(org_id, 'attendance.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));
create policy events_insert_self on public.attendance_events for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and source in ('mobile_selfie','web')
              and event_time between now() - interval '10 minutes' and now() + interval '2 minutes');
create policy events_insert_hr on public.attendance_events for insert to authenticated
  with check (app.can(org_id, 'attendance.write'));
create policy daily_select on public.attendance_daily for select to authenticated
  using (app.can(org_id, 'attendance.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));
create policy daily_write on public.attendance_daily for all to authenticated
  using (app.can(org_id, 'attendance.write') and not locked) with check (app.can(org_id, 'attendance.write'));

create policy leave_types_select on public.leave_types for select to authenticated using (org_id in (select app.user_org_ids()));
create policy leave_types_write on public.leave_types for all to authenticated
  using (app.can(org_id, 'leave.config')) with check (app.can(org_id, 'leave.config'));
create policy ledger_select on public.leave_ledger for select to authenticated
  using (app.can(org_id, 'leave.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));
create policy ledger_insert_hr on public.leave_ledger for insert to authenticated
  with check (app.can(org_id, 'leave.config'));
create policy leave_req_select on public.leave_requests for select to authenticated
  using (app.can(org_id, 'leave.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));
create policy regs_select on public.attendance_regularizations for select to authenticated
  using (app.can(org_id, 'attendance.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));

-- Helpers are SECURITY DEFINER so the approval tables can reference each other without recursive policies.
create or replace function app.is_step_approver(req uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.approval_steps s
                 where s.request_id = req and s.approver_employee_id is not null
                   and s.approver_employee_id = app.my_employee_id(s.org_id))
$$;
create or replace function app.is_requester(req uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.approval_requests r
                 where r.id = req and r.requester_employee_id = app.my_employee_id(r.org_id))
$$;

create policy approvals_select on public.approval_requests for select to authenticated
  using (requester_employee_id = app.my_employee_id(org_id) or app.can(org_id, 'approvals.read') or app.is_step_approver(id));
create policy steps_select on public.approval_steps for select to authenticated
  using (approver_employee_id = app.my_employee_id(org_id) or app.can(org_id, 'approvals.read') or app.is_requester(request_id));
create policy actions_select on public.approval_actions for select to authenticated
  using (app.can(org_id, 'approvals.read') or app.is_requester(request_id) or app.is_step_approver(request_id));

create trigger trg_audit_leave_req  after insert or update or delete on public.leave_requests
  for each row execute function app.audit_row();
create trigger trg_audit_org_settings after insert or update on public.org_settings
  for each row execute function app.audit_row();
