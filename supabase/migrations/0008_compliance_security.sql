-- Compliance and security features that apply to every customer regardless of the modules they buy:
-- DPDP (consent, notices, data-subject requests, breach register, retention), POSH, policy acknowledgement,
-- the Regulatory Change Center, the statutory due-date calendar, security events and notifications.

-- ---------------------------------------------------------------------------------------------
-- DPDP: privacy notices, consent records, data-subject requests, breach register, retention
-- ---------------------------------------------------------------------------------------------
create table public.privacy_notices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  version      integer not null,
  title        text not null default 'Employee privacy notice',
  body         text not null,
  language     text not null default 'en',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, version, language)
);

create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  subject_type   text not null check (subject_type in ('employee','candidate')),
  subject_id     uuid not null,
  purpose        text not null check (purpose in ('employment_records','payroll_processing','biometric_attendance','location_tracking','background_verification','marketing','recruitment_retention','other')),
  notice_version integer,
  granted_at     timestamptz not null default now(),
  withdrawn_at   timestamptz,
  ip             inet,
  created_at     timestamptz not null default now()
);
create index on public.consents (org_id, subject_type, subject_id);

create table public.data_subject_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  employee_id   uuid not null,
  request_type  text not null check (request_type in ('access','correction','erasure','grievance','nomination')),
  details       text,
  status        text not null default 'received' check (status in ('received','in_progress','completed','rejected')),
  received_at   timestamptz not null default now(),
  due_at        timestamptz not null default (now() + interval '30 days'),     -- internal SLA; the statutory outer limit differs by request type
  completed_at  timestamptz,
  resolution    text,
  handled_by    uuid,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);
create index on public.data_subject_requests (org_id, status);

create table public.breach_register (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  detected_at               timestamptz not null,
  description               text not null,
  data_categories           text[] not null default '{}',
  affected_count            integer,
  severity                  text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status                    text not null default 'open' check (status in ('open','contained','notified','closed')),
  cert_in_reported_at       timestamptz,
  board_notified_at         timestamptz,
  individuals_notified_at   timestamptz,
  root_cause                text,
  remediation               text,
  created_by                uuid default app.uid(),
  created_at                timestamptz not null default now()
);

create table public.retention_policies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  data_category text not null check (data_category in ('candidates','exited_employee_documents','attendance_events','notifications','security_events')),
  retention_days integer not null check (retention_days >= 30),
  unique (org_id, data_category)
);

-- Purge job. Run daily by the platform scheduler (service role). Returns what it removed.
create or replace function app.run_retention() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c integer; n integer; d integer;
begin
  delete from public.candidates where retain_until < current_date and stage in ('rejected','withdrawn','applied','screening');
  get diagnostics c = row_count;
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics n = row_count;
  delete from public.trusted_devices where revoked_at is not null and revoked_at < now() - interval '30 days';
  get diagnostics d = row_count;
  return jsonb_build_object('candidates', c, 'notifications', n, 'trusted_devices', d);
end $$;

-- ---------------------------------------------------------------------------------------------
-- POSH: internal committee complaint register. Visible only to holders of posh.manage (with MFA) and the
-- complainant. Details never enter the general audit log; only ids and status changes do.
-- ---------------------------------------------------------------------------------------------
create table public.posh_complaints (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null,
  complaint_no            text,
  complainant_employee_id uuid not null,
  respondent_employee_id  uuid,
  incident_date           date,
  description             text not null,
  status                  text not null default 'received' check (status in ('received','conciliation','inquiry','concluded','closed')),
  icc_members             text[] not null default '{}',
  findings                text,
  action_taken            text,
  received_at             timestamptz not null default now(),
  inquiry_due_at          timestamptz not null default (now() + interval '90 days'),
  concluded_at            timestamptz,
  foreign key (complainant_employee_id, org_id) references public.employees (id, org_id),
  foreign key (respondent_employee_id, org_id) references public.employees (id, org_id)
);
create or replace function app.posh_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, entity_type, entity_id, detail)
  values (new.org_id, app.uid(), lower(tg_op), 'posh_complaint', new.id::text, jsonb_build_object('status', new.status));
  return null;
end $$;
create trigger trg_posh_audit after insert or update on public.posh_complaints for each row execute function app.posh_audit();
create or replace function app.posh_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.complaint_no := 'POSH-' || to_char(now(), 'YYYY') || '-' || lpad(((select count(*) from public.posh_complaints where org_id = new.org_id) + 1)::text, 3, '0');
  return new;
end $$;
create trigger trg_posh_number before insert on public.posh_complaints for each row execute function app.posh_number();

-- ---------------------------------------------------------------------------------------------
-- HR policy documents with acknowledgement
-- ---------------------------------------------------------------------------------------------
create table public.policy_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  title        text not null,
  version      integer not null default 1,
  storage_path text,
  body         text,
  requires_ack boolean not null default true,
  published_at timestamptz,
  unique (id, org_id)
);
create table public.policy_acks (
  policy_id   uuid not null,
  org_id      uuid not null,
  employee_id uuid not null,
  acked_at    timestamptz not null default now(),
  primary key (policy_id, employee_id),
  foreign key (policy_id, org_id) references public.policy_documents (id, org_id) on delete cascade,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Regulatory Change Center: HumaNest publishes, customers see the change and its impact and decide when to adopt
-- ---------------------------------------------------------------------------------------------
create table public.regulatory_changes (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  summary        text not null,
  area           text not null check (area in ('pf','esi','pt','lwf','tds','labour_code','dpdp','posh','gratuity','bonus','other')),
  status         text not null check (status in ('announced','in_force','withdrawn')),
  effective_from date,                                   -- null when the government has not stated one
  rule_key       text,                                   -- statutory_rules key this change touches, if any
  source         text not null,
  confidence     text not null default 'medium' check (confidence in ('high','medium','low')),
  published_at   timestamptz not null default now(),
  published_by   uuid
);
create table public.org_regulatory_decisions (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  change_id  uuid not null references public.regulatory_changes(id) on delete cascade,
  decision   text not null check (decision in ('adopt','defer','not_applicable')),
  adopt_from_month text check (adopt_from_month is null or adopt_from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  decided_by uuid default app.uid(),
  decided_at timestamptz not null default now(),
  primary key (org_id, change_id)
);

-- ---------------------------------------------------------------------------------------------
-- Statutory due-date rules and calendar generation
-- ---------------------------------------------------------------------------------------------
create table public.compliance_calendar_rules (
  code        text primary key,
  title       text not null,
  filing_type text not null,
  frequency   text not null check (frequency in ('monthly','quarterly','annual')),
  due_rule    jsonb not null,           -- monthly: {"day":15,"month_offset":1}; quarterly: {"quarter_end_months":{...}}; annual: {"month":6,"day":15}
  confidence  text not null default 'high' check (confidence in ('high','medium','low')),
  source      text not null,
  notes       text
);

create or replace function app.generate_filings(p_org uuid, p_month text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ent uuid; y int := substr(p_month, 1, 4)::int; m int := substr(p_month, 6, 2)::int; n integer := 0; k integer;
  nxt date := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  q text; qdue date;
begin
  if not app.can_mfa(p_org, 'compliance.file') then raise exception 'Not permitted' using errcode = '42501'; end if;
  select id into ent from public.legal_entities where org_id = p_org and is_default limit 1;
  insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date) values
    (p_org, ent, 'pf_challan', p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'pf_ecr',     p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'esi_challan',p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'tds_challan',p_month, case when m = 3 then make_date(y, 4, 30) else make_date(extract(year from nxt)::int, extract(month from nxt)::int, 7) end)
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  if m in (6, 9, 12, 3) then
    q := case m when 6 then 'Q1' when 9 then 'Q2' when 12 then 'Q3' else 'Q4' end;
    qdue := case m when 6 then make_date(y, 7, 31) when 9 then make_date(y, 10, 31) when 12 then make_date(y + 1, 1, 31) else make_date(y, 5, 31) end;
    insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date)
    values (p_org, ent, 'tds_return', 'FY' || (case when m = 3 then y - 1 else y end) || '-' || right(((case when m = 3 then y else y + 1 end))::text, 2) || '-' || q, qdue)
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;
  if m = 3 then
    insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date)
    values (p_org, ent, 'form16', 'FY' || (y - 1) || '-' || right(y::text, 2), make_date(y, 6, 15))
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Security events, trusted devices, notifications
-- ---------------------------------------------------------------------------------------------
create table public.security_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid,
  user_id    uuid,
  event_type text not null check (event_type in ('login_success','login_failed','logout','mfa_enrolled','mfa_removed','password_changed','new_device','session_revoked','pii_revealed','export_downloaded')),
  ip         inet,
  user_agent text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.security_events (user_id, created_at desc);
create index on public.security_events (org_id, created_at desc);
create trigger trg_security_events_immutable before update or delete on public.security_events
  for each row execute function app.deny_modification();

create table public.trusted_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  fingerprint_hash text not null,
  label       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (user_id, fingerprint_hash)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid,
  user_id    uuid not null,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['privacy_notices','consents','data_subject_requests','breach_register','retention_policies','posh_complaints',
    'policy_documents','policy_acks','regulatory_changes','org_regulatory_decisions','compliance_calendar_rules','security_events',
    'trusted_devices','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy notices_select on public.privacy_notices for select to authenticated
  using (org_id in (select app.user_org_ids()) and published_at is not null or app.can(org_id, 'privacy.manage'));
create policy notices_write on public.privacy_notices for all to authenticated
  using (app.can(org_id, 'privacy.manage')) with check (app.can(org_id, 'privacy.manage'));

create policy consents_select on public.consents for select to authenticated
  using (app.can(org_id, 'privacy.manage') or (subject_type = 'employee' and subject_id = app.my_employee_id(org_id)));
create policy consents_insert on public.consents for insert to authenticated
  with check ((subject_type = 'employee' and subject_id = app.my_employee_id(org_id) and withdrawn_at is null)
              or app.can(org_id, 'privacy.manage'));
-- withdrawal is a function so the grant record itself can never be rewritten
create or replace function app.withdraw_consent(p_consent uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.consents%rowtype;
begin
  select * into c from public.consents where id = p_consent for update;
  if not found or not (app.can(c.org_id, 'privacy.manage') or (c.subject_type = 'employee' and c.subject_id = app.my_employee_id(c.org_id))) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.consents set withdrawn_at = coalesce(withdrawn_at, now()) where id = p_consent;
  perform app.log_event(c.org_id, 'consent.withdrawn', 'consent', p_consent::text, jsonb_build_object('purpose', c.purpose));
end $$;

create policy dsr_select on public.data_subject_requests for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.can(org_id, 'privacy.manage'));
create policy dsr_insert on public.data_subject_requests for insert to authenticated
  with check ((employee_id = app.my_employee_id(org_id) and status = 'received') or app.can(org_id, 'privacy.manage'));
create policy dsr_update on public.data_subject_requests for update to authenticated
  using (app.can(org_id, 'privacy.manage')) with check (app.can(org_id, 'privacy.manage'));

create policy breach_select on public.breach_register for select to authenticated using (app.can_mfa(org_id, 'privacy.manage'));
create policy breach_write on public.breach_register for all to authenticated
  using (app.can_mfa(org_id, 'privacy.manage')) with check (app.can_mfa(org_id, 'privacy.manage'));

create policy retention_select on public.retention_policies for select to authenticated using (app.can(org_id, 'settings.read'));
create policy retention_write on public.retention_policies for all to authenticated
  using (app.can_mfa(org_id, 'settings.write')) with check (app.can_mfa(org_id, 'settings.write'));

create policy posh_select on public.posh_complaints for select to authenticated
  using (app.can_mfa(org_id, 'posh.manage') or complainant_employee_id = app.my_employee_id(org_id));
create policy posh_insert on public.posh_complaints for insert to authenticated
  with check (complainant_employee_id = app.my_employee_id(org_id) and status = 'received');
create policy posh_manage on public.posh_complaints for update to authenticated
  using (app.can_mfa(org_id, 'posh.manage')) with check (app.can_mfa(org_id, 'posh.manage'));

create policy policies_select on public.policy_documents for select to authenticated
  using (org_id in (select app.user_org_ids()) and published_at is not null or app.can(org_id, 'settings.write'));
create policy policies_write on public.policy_documents for all to authenticated
  using (app.can(org_id, 'settings.write')) with check (app.can(org_id, 'settings.write'));
create policy acks_select on public.policy_acks for select to authenticated
  using (employee_id = app.my_employee_id(org_id) or app.can(org_id, 'privacy.manage') or app.can(org_id, 'settings.read'));
create policy acks_insert on public.policy_acks for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id));

create policy regchg_select on public.regulatory_changes for select to authenticated using (true);
create policy regchg_write on public.regulatory_changes for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));
create policy regdec_select on public.org_regulatory_decisions for select to authenticated
  using (app.can(org_id, 'settings.read') or app.can(org_id, 'payroll.read'));
create policy regdec_write on public.org_regulatory_decisions for all to authenticated
  using (app.can_mfa(org_id, 'payroll.config')) with check (app.can_mfa(org_id, 'payroll.config'));
create policy calrules_select on public.compliance_calendar_rules for select to authenticated using (true);
create policy calrules_write on public.compliance_calendar_rules for all to authenticated
  using (app.platform_can('manage_statutory_rules')) with check (app.platform_can('manage_statutory_rules'));

create policy secev_select on public.security_events for select to authenticated
  using (user_id = app.uid() or (org_id is not null and app.can_mfa(org_id, 'audit.read')));
create policy devices_own on public.trusted_devices for all to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());
create policy notif_select on public.notifications for select to authenticated using (user_id = app.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

create trigger trg_audit_breach   after insert or update or delete on public.breach_register for each row execute function app.audit_row();
create trigger trg_audit_dsr      after insert or update on public.data_subject_requests for each row execute function app.audit_row();
create trigger trg_audit_notices  after insert or update or delete on public.privacy_notices for each row execute function app.audit_row();
create trigger trg_audit_regdec   after insert or update or delete on public.org_regulatory_decisions for each row execute function app.audit_row();
