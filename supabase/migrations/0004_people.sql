-- People: departments, designations, grades, employees and their personal / statutory records.
--
-- Data-minimisation design (DPDP Act): the company directory (employees) holds only work-profile
-- fields that every colleague may see. Personal data, job/grade data and statutory identifiers live
-- in separate tables with stricter row level security. Aadhaar is stored as last four digits only.
-- PAN and bank account numbers are stored encrypted; the readable copy is last four characters.

create table public.departments (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  name      text not null,
  code      text,
  parent_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, name),
  foreign key (parent_id, org_id) references public.departments (id, org_id)
);

create table public.designations (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  name      text not null,
  level     integer,
  is_active boolean not null default true,
  unique (id, org_id),
  unique (org_id, name)
);

create table public.grades (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  code       text not null,               -- E1, E2, M1 ...
  name       text not null,
  min_ctc    numeric(14,2),
  max_ctc    numeric(14,2),
  sort_order integer not null default 0,
  unique (id, org_id),
  unique (org_id, code),
  check (max_ctc is null or min_ctc is null or max_ctc >= min_ctc)
);

create table public.employees (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  employee_code        text not null,
  full_name            text not null,
  work_email           text check (work_email is null or work_email = lower(work_email)),
  work_phone           text,
  doj                  date not null,
  exit_date            date,
  -- exit reason lives in employee_history (change_type = exit): the directory is visible to every member
  status               text not null default 'onboarding' check (status in ('onboarding','active','on_notice','inactive','exited')),
  employment_type      text not null default 'permanent' check (employment_type in ('permanent','fixed_term','contract','intern','consultant')),
  contract_end_date    date,
  department_id        uuid,
  designation_id       uuid,
  location_id          uuid,
  entity_id            uuid,
  reporting_manager_id uuid,
  avatar_path          text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, employee_code),
  check (exit_date is null or exit_date >= doj),
  check (employment_type <> 'fixed_term' or contract_end_date is not null),
  foreign key (department_id, org_id) references public.departments (id, org_id),
  foreign key (designation_id, org_id) references public.designations (id, org_id),
  foreign key (location_id, org_id) references public.locations (id, org_id),
  foreign key (entity_id, org_id) references public.legal_entities (id, org_id),
  foreign key (reporting_manager_id, org_id) references public.employees (id, org_id),
  check (reporting_manager_id is null or reporting_manager_id <> id)
);
create index on public.employees (org_id, status);
create index on public.employees (org_id, department_id);
create index on public.employees (org_id, reporting_manager_id);
create unique index employees_org_email on public.employees (org_id, work_email) where work_email is not null;
create trigger trg_employees_touch before update on public.employees
  for each row execute function app.touch_updated_at();

alter table public.org_members
  add constraint org_members_employee_fk foreign key (employee_id, org_id) references public.employees (id, org_id);

create table public.employee_job_profile (
  employee_id        uuid primary key,
  org_id             uuid not null,
  grade_id           uuid,
  cost_center        text,
  work_mode          text not null default 'office' check (work_mode in ('office','remote','hybrid','field')),
  notice_period_days integer not null default 30 check (notice_period_days >= 0),
  probation_end_date date,
  confirmation_date  date,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (grade_id, org_id) references public.grades (id, org_id)
);
create index on public.employee_job_profile (org_id);

create table public.employee_personal (
  employee_id      uuid primary key,
  org_id           uuid not null,
  dob              date,
  gender           text check (gender in ('M','F','O')),
  marital_status   text check (marital_status in ('single','married','divorced','widowed','other')),
  blood_group      text,
  personal_email   text,
  personal_phone   text,
  current_address  jsonb not null default '{}'::jsonb,
  permanent_address jsonb not null default '{}'::jsonb,
  emergency_contacts jsonb not null default '[]'::jsonb,
  nationality      text not null default 'Indian',
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.employee_personal (org_id);

-- Statutory identifiers. *_enc columns are pgcrypto-encrypted with a key that never lives in the
-- database; the plain copy is masked to the last four characters. Aadhaar full number is NOT stored.
create table public.employee_statutory (
  employee_id      uuid primary key,
  org_id           uuid not null,
  pan_enc          bytea,
  pan_last4        text check (pan_last4 is null or length(pan_last4) = 4),
  aadhaar_last4    text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  uan              text check (uan is null or uan ~ '^[0-9]{12}$'),
  esi_ip_number    text check (esi_ip_number is null or esi_ip_number ~ '^[0-9]{10,17}$'),
  pf_applicable    boolean not null default true,
  pf_on_actual     boolean not null default false,     -- contribute on wages above the ceiling
  esi_applicable   boolean not null default false,
  pt_applicable    boolean not null default true,
  lwf_applicable   boolean not null default true,
  tax_regime       text not null default 'new' check (tax_regime in ('new','old')),
  bank_account_enc bytea,
  bank_last4       text check (bank_last4 is null or length(bank_last4) = 4),
  ifsc             text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name        text,
  verified_at      timestamptz,
  updated_at       timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.employee_statutory (org_id);
create trigger trg_employee_statutory_touch before update on public.employee_statutory
  for each row execute function app.touch_updated_at();

create table public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  employee_id  uuid not null,
  doc_type     text not null check (doc_type in ('aadhaar','pan','offer_letter','appointment','education','experience','payslip','form130','relieving','other')),
  title        text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  visibility   text not null default 'employee' check (visibility in ('employee','hr_only')),
  uploaded_by  uuid,
  verified_by  uuid,
  verified_at  timestamptz,
  expires_on   date,
  created_at   timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.employee_documents (org_id, employee_id);

create table public.employee_history (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  employee_id    uuid not null,
  effective_from date not null,
  change_type    text not null check (change_type in ('joining','confirmation','promotion','transfer','grade_change','designation_change','manager_change','salary_revision','exit')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.employee_history (org_id, employee_id, effective_from desc);

-- ---------------------------------------------------------------------------------------------
-- Seats: keep a counter and block new employees beyond the licence when the customer is set to block.
-- ---------------------------------------------------------------------------------------------
alter table public.organization_licenses add column seats_used integer not null default 0;

create or replace function app.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.organization_licenses%rowtype;
  used integer;
  counted constant text[] := array['onboarding','active','on_notice'];
begin
  if new.status = any (counted) and (tg_op = 'INSERT' or not (old.status = any (counted))) then
    perform pg_advisory_xact_lock(hashtext('seats:' || new.org_id::text));
    select * into l from public.organization_licenses where org_id = new.org_id;
    if found and l.block_over_allocation then
      select count(*) into used from public.employees
        where org_id = new.org_id and status = any (counted) and id <> new.id;
      if used + 1 > l.seats_total then
        raise exception 'SEAT_LIMIT_REACHED: % of % seats in use', used, l.seats_total using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_employees_seat_limit before insert or update of status on public.employees
  for each row execute function app.enforce_seat_limit();

create or replace function app.refresh_seats_used() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  update public.organization_licenses l
     set seats_used = (select count(*) from public.employees e where e.org_id = org and e.status in ('onboarding','active','on_notice'))
   where l.org_id = org;
  return null;
end $$;
create trigger trg_employees_seats_used after insert or update of status or delete on public.employees
  for each row execute function app.refresh_seats_used();

-- ---------------------------------------------------------------------------------------------
-- Access helpers and PII encryption
-- ---------------------------------------------------------------------------------------------
create or replace function app.is_manager_of(emp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.employees e
    join public.org_members m on m.org_id = e.org_id and m.user_id = app.uid() and m.is_active
    where e.id = emp and e.reporting_manager_id is not null and e.reporting_manager_id = m.employee_id
      and app.org_is_usable(e.org_id)
  )
$$;

-- The encryption key is supplied per session by the API layer (from KMS / Vault), never stored in the database.
create or replace function app.pii_key() returns text
language plpgsql stable as $$
declare k text := nullif(current_setting('app.pii_key', true), '');
begin
  if k is null then raise exception 'PII encryption key is not available in this session' using errcode = '28000'; end if;
  return k;
end $$;

create or replace function app.pii_encrypt(v text) returns bytea
language sql stable as $$
  select case when v is null then null else extensions.pgp_sym_encrypt(v, app.pii_key(), 'cipher-algo=aes256') end
$$;

-- Reveal one statutory field. Allowed with the pii.reveal permission (MFA) or for the employee themselves (MFA).
-- Every reveal is written to the audit log.
create or replace function app.reveal_statutory(emp uuid, field text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid;
  raw bytea;
  allowed boolean;
begin
  if field not in ('pan','bank_account') then raise exception 'Unknown field %', field; end if;
  select e.org_id into org from public.employees e where e.id = emp;
  if org is null then return null; end if;
  allowed := app.aal2() and (app.can(org, 'pii.reveal') or emp = app.my_employee_id(org));
  if not allowed then raise exception 'Not permitted' using errcode = '42501'; end if;
  select case field when 'pan' then s.pan_enc else s.bank_account_enc end into raw
    from public.employee_statutory s where s.employee_id = emp;
  perform app.log_event(org, 'pii.reveal', 'employee_statutory', emp::text, jsonb_build_object('field', field));
  if raw is null then return null; end if;
  return extensions.pgp_sym_decrypt(raw, app.pii_key());
end $$;

-- Write statutory identifiers. The caller sends plain values; they are encrypted here and only the last
-- four digits are kept readable. Aadhaar: only the last four digits are ever accepted (DPDP data minimisation).
create or replace function app.save_statutory(
  emp uuid, p_pan text default null, p_bank_account text default null, p_ifsc text default null,
  p_bank_name text default null, p_uan text default null, p_esi_ip text default null, p_aadhaar_last4 text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid;
begin
  select e.org_id into org from public.employees e where e.id = emp;
  if org is null or not app.can_mfa(org, 'people.sensitive.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_pan is not null and upper(p_pan) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Invalid PAN format'; end if;
  if p_ifsc is not null and upper(p_ifsc) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Invalid IFSC format'; end if;
  if p_uan is not null and p_uan !~ '^[0-9]{12}$' then raise exception 'UAN must be 12 digits'; end if;
  if p_aadhaar_last4 is not null and p_aadhaar_last4 !~ '^[0-9]{4}$' then raise exception 'Only the last 4 digits of Aadhaar are stored'; end if;
  insert into public.employee_statutory (employee_id, org_id) values (emp, org) on conflict (employee_id) do nothing;
  update public.employee_statutory set
    pan_enc          = case when p_pan is not null then app.pii_encrypt(upper(p_pan)) else pan_enc end,
    pan_last4        = case when p_pan is not null then right(upper(p_pan), 4) else pan_last4 end,
    bank_account_enc = case when p_bank_account is not null then app.pii_encrypt(p_bank_account) else bank_account_enc end,
    bank_last4       = case when p_bank_account is not null then right(p_bank_account, 4) else bank_last4 end,
    ifsc             = coalesce(upper(p_ifsc), ifsc),
    bank_name        = coalesce(p_bank_name, bank_name),
    uan              = coalesce(p_uan, uan),
    esi_ip_number    = coalesce(p_esi_ip, esi_ip_number),
    aadhaar_last4    = coalesce(p_aadhaar_last4, aadhaar_last4),
    updated_at       = now()
  where employee_id = emp;
  perform app.log_event(org, 'statutory.update', 'employee_statutory', emp::text,
    jsonb_build_object('fields', array_remove(array[
      case when p_pan is not null then 'pan' end, case when p_bank_account is not null then 'bank_account' end,
      case when p_ifsc is not null then 'ifsc' end, case when p_uan is not null then 'uan' end,
      case when p_esi_ip is not null then 'esi_ip' end, case when p_aadhaar_last4 is not null then 'aadhaar_last4' end], null)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.departments          enable row level security;
alter table public.designations         enable row level security;
alter table public.grades               enable row level security;
alter table public.employees            enable row level security;
alter table public.employee_job_profile enable row level security;
alter table public.employee_personal    enable row level security;
alter table public.employee_statutory   enable row level security;
alter table public.employee_documents   enable row level security;
alter table public.employee_history     enable row level security;

-- Reference tables: readable by every member of the organisation, writable by people.write.
create policy departments_select on public.departments for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.has_support_grant(org_id));
create policy departments_write on public.departments for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));
create policy designations_select on public.designations for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.has_support_grant(org_id));
create policy designations_write on public.designations for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));
create policy grades_select on public.grades for select to authenticated
  using (app.can_read(org_id, 'people.read'));
create policy grades_write on public.grades for all to authenticated
  using (app.can(org_id, 'payroll.config')) with check (app.can(org_id, 'payroll.config'));

-- Company directory (work-profile only)
create policy employees_select on public.employees for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.has_support_grant(org_id));
create policy employees_write on public.employees for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));

-- Job profile (grade etc): HR, the employee, or their manager.
create policy job_profile_select on public.employee_job_profile for select to authenticated
  using (app.can_read(org_id, 'people.read') or employee_id = app.my_employee_id(org_id) or app.is_manager_of(employee_id));
create policy job_profile_write on public.employee_job_profile for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));

-- Personal data: HR or the employee. Managers and support do not see it.
create policy personal_select on public.employee_personal for select to authenticated
  using (app.can(org_id, 'people.read') or employee_id = app.my_employee_id(org_id));
create policy personal_write on public.employee_personal for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));

-- Statutory identifiers: MFA required. HR with sensitive permission, or the employee themself.
create policy statutory_select on public.employee_statutory for select to authenticated
  using (app.can_mfa(org_id, 'people.sensitive.read') or (app.aal2() and employee_id = app.my_employee_id(org_id)));
create policy statutory_write on public.employee_statutory for all to authenticated
  using (app.can_mfa(org_id, 'people.sensitive.write')) with check (app.can_mfa(org_id, 'people.sensitive.write'));

-- Documents
create policy documents_select on public.employee_documents for select to authenticated
  using (app.can(org_id, 'people.read') or (employee_id = app.my_employee_id(org_id) and visibility = 'employee'));
create policy documents_insert_hr on public.employee_documents for insert to authenticated
  with check (app.can(org_id, 'people.write'));
create policy documents_insert_self on public.employee_documents for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and doc_type in ('education','experience','other')
              and visibility = 'employee' and uploaded_by = app.uid());
create policy documents_update on public.employee_documents for update to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));
create policy documents_delete on public.employee_documents for delete to authenticated
  using (app.can(org_id, 'people.write'));

-- History
create policy history_select on public.employee_history for select to authenticated
  using (app.can(org_id, 'people.read') or employee_id = app.my_employee_id(org_id));
create policy history_write on public.employee_history for all to authenticated
  using (app.can(org_id, 'people.write')) with check (app.can(org_id, 'people.write'));

-- Audit every change to people records
create trigger trg_audit_employees        after insert or update or delete on public.employees
  for each row execute function app.audit_row();
create trigger trg_audit_employee_stat    after insert or update or delete on public.employee_statutory
  for each row execute function app.audit_row();
create trigger trg_audit_employee_job     after insert or update or delete on public.employee_job_profile
  for each row execute function app.audit_row();
