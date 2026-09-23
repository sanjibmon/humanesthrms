-- Supabase-specific hardening. This is the ONLY migration that assumes Supabase (roles anon /
-- authenticated / service_role, Vault). On a dedicated PostgreSQL server, replace it with the
-- equivalent grants for your API layer and keep everything else unchanged.

create schema if not exists api;

-- ---------------------------------------------------------------------------------------------
-- 1. Nothing is reachable by anonymous visitors. There is no public API: every call is a signed-in user.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from public, anon;
alter default privileges in schema app    revoke all on functions from public, anon;
alter default privileges in schema api    revoke all on functions from public, anon;

-- Row level security does not cover TRUNCATE, so nobody but the owner and service role gets it.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Append-only and function-only tables: signed-in users can read (through RLS) but never write directly.
-- ---------------------------------------------------------------------------------------------
revoke insert, update, delete on public.audit_logs, public.platform_audit_logs,
  public.approval_requests, public.approval_steps, public.approval_actions,
  public.attendance_regularizations, public.leave_requests,
  public.pay_runs, public.pay_run_items, public.payslips, public.loan_repayments from authenticated;
revoke insert, delete on public.exit_requests from authenticated;
revoke insert, update, delete on public.security_events from authenticated;
revoke update, delete on public.consents from authenticated;   -- consent records are evidence; withdrawal uses app.withdraw_consent
revoke insert, delete on public.notifications from authenticated;
-- Punches and the leave ledger are append-only for everyone, including the owner role (triggers) and API users (grants).
revoke update, delete on public.attendance_events, public.leave_ledger from authenticated;

-- Encrypted columns are never selectable by API users. Reveal goes through app.reveal_statutory (audited).
revoke all on public.employee_statutory from authenticated;
grant select (employee_id, org_id, pan_last4, aadhaar_last4, uan, esi_ip_number, pf_applicable, pf_on_actual,
              esi_applicable, pt_applicable, lwf_applicable, tax_regime, bank_last4, ifsc, bank_name, verified_at, updated_at)
  on public.employee_statutory to authenticated;
-- writes go through app.save_statutory (encrypts, validates, audits)

-- ---------------------------------------------------------------------------------------------
-- 3. Function privileges. Policies call helpers as the signed-in user, so those need EXECUTE. The key
--    material and internal mutators do not. The "app" schema is never added to the API's exposed schemas.
-- ---------------------------------------------------------------------------------------------
grant usage on schema app to authenticated, service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.jwt_claim(text), app.uid(), app.aal2(), app.platform_can(text), app.is_platform_user(),
  app.org_is_usable(uuid), app.user_org_ids(), app.can(uuid, text), app.can_mfa(uuid, text),
  app.my_employee_id(uuid), app.has_support_grant(uuid), app.can_read(uuid, text), app.is_manager_of(uuid),
  app.protect_org_columns(), app.leave_days(uuid, date, date, text), app.leave_balance(uuid, uuid, integer),
  app.apply_leave(uuid, date, date, text, text, text), app.cancel_leave(uuid),
  app.decide_approval(uuid, text, text, uuid),
  app.request_regularization(date, text, timestamptz, timestamptz, text),
  app.reveal_statutory(uuid, text), app.save_statutory(uuid, text, text, text, text, text, text, text),
  app.verify_audit_chain(uuid), app.audit_row(), app.audit_chain(), app.deny_modification(),
  app.touch_updated_at(), app.check_module_dependencies(), app.enforce_seat_limit(), app.refresh_seats_used(),
  app.attendance_event_before(), app.attendance_event_after(), app.is_step_approver(uuid), app.is_requester(uuid),
  app.module_enabled(uuid, text), app.fy_start_ym(text), app.compensation_guard(), app.pay_run_guard(), app.pay_run_item_guard(), app.tax_item_guard(),
  app.payroll_days(uuid, text), app.payroll_inputs(uuid), app.create_pay_run(uuid, text, uuid, text),
  app.save_pay_run_items(uuid, jsonb, jsonb, text), app.approve_pay_run(uuid), app.reopen_pay_run(uuid, text),
  app.lock_pay_run(uuid), app.publish_payslips(uuid), app.mark_pay_run_paid(uuid),
  app.is_interviewer(uuid), app.current_employee(), app.submit_expense(uuid), app.submit_resignation(text, date),
  app.complete_exit(uuid), app.submit_requisition(uuid), app.submit_offer(uuid),
  app.withdraw_consent(uuid), app.generate_filings(uuid, text)
to authenticated;
grant execute on all functions in schema app to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Encryption key: read from Supabase Vault (secret name pii_master_key), falling back to the session
--    setting app.pii_key for local development and for a dedicated server. SECURITY DEFINER, and never
--    granted to API users.
-- ---------------------------------------------------------------------------------------------
create or replace function app.pii_key() returns text
language plpgsql stable security definer set search_path = pg_temp as $$
declare k text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''pii_master_key'' limit 1' into k;
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    k := null;
  end;
  k := coalesce(k, nullif(current_setting('app.pii_key', true), ''));
  if k is null then raise exception 'PII encryption key is not configured' using errcode = '28000'; end if;
  return k;
end $$;
revoke execute on function app.pii_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Curated RPC surface. The front end calls api.* only. Each wrapper runs as the caller, so RLS and
--    the checks inside the app.* functions still apply.
-- ---------------------------------------------------------------------------------------------
create schema if not exists api;
grant usage on schema api to authenticated, service_role;

create or replace function api.apply_leave(p_type uuid, p_from date, p_to date, p_half text default 'none', p_reason text default null, p_doc text default null)
returns uuid language sql security invoker as $$ select app.apply_leave(p_type, p_from, p_to, p_half, p_reason, p_doc) $$;
create or replace function api.cancel_leave(p_leave uuid)
returns void language sql security invoker as $$ select app.cancel_leave(p_leave) $$;
create or replace function api.decide_approval(req uuid, decision text, p_comment text default null, p_forward_to uuid default null)
returns text language sql security invoker as $$ select app.decide_approval(req, decision, p_comment, p_forward_to) $$;
create or replace function api.request_regularization(p_date date, p_type text, p_in timestamptz, p_out timestamptz, p_reason text)
returns uuid language sql security invoker as $$ select app.request_regularization(p_date, p_type, p_in, p_out, p_reason) $$;
create or replace function api.leave_balance(emp uuid, ltype uuid, yr integer)
returns numeric language sql security invoker as $$ select app.leave_balance(emp, ltype, yr) $$;
create or replace function api.reveal_statutory(emp uuid, field text)
returns text language sql security invoker as $$ select app.reveal_statutory(emp, field) $$;
create or replace function api.save_statutory(emp uuid, p_pan text default null, p_bank_account text default null, p_ifsc text default null,
  p_bank_name text default null, p_uan text default null, p_esi_ip text default null, p_aadhaar_last4 text default null)
returns void language sql security invoker as $$ select app.save_statutory(emp, p_pan, p_bank_account, p_ifsc, p_bank_name, p_uan, p_esi_ip, p_aadhaar_last4) $$;
create or replace function api.verify_audit_chain(org uuid)
returns table (ok boolean, first_bad_seq bigint) language sql security invoker as $$ select * from app.verify_audit_chain(org) $$;

create or replace function api.create_pay_run(p_org uuid, p_month text, p_entity uuid default null, p_type text default 'regular')
returns uuid language sql security invoker as $$ select app.create_pay_run(p_org, p_month, p_entity, p_type) $$;
create or replace function api.payroll_inputs(p_run uuid)
returns jsonb language sql security invoker as $$ select app.payroll_inputs(p_run) $$;
create or replace function api.save_pay_run_items(p_run uuid, p_items jsonb, p_params jsonb, p_engine_version text)
returns jsonb language sql security invoker as $$ select app.save_pay_run_items(p_run, p_items, p_params, p_engine_version) $$;
create or replace function api.approve_pay_run(p_run uuid)
returns void language sql security invoker as $$ select app.approve_pay_run(p_run) $$;
create or replace function api.reopen_pay_run(p_run uuid, p_reason text)
returns void language sql security invoker as $$ select app.reopen_pay_run(p_run, p_reason) $$;
create or replace function api.lock_pay_run(p_run uuid)
returns void language sql security invoker as $$ select app.lock_pay_run(p_run) $$;
create or replace function api.publish_payslips(p_run uuid)
returns integer language sql security invoker as $$ select app.publish_payslips(p_run) $$;
create or replace function api.mark_pay_run_paid(p_run uuid)
returns void language sql security invoker as $$ select app.mark_pay_run_paid(p_run) $$;

create or replace function api.submit_expense(p_claim uuid) returns uuid language sql security invoker as $$ select app.submit_expense(p_claim) $$;
create or replace function api.submit_resignation(p_reason text, p_lwd date default null) returns uuid language sql security invoker as $$ select app.submit_resignation(p_reason, p_lwd) $$;
create or replace function api.complete_exit(p_exit uuid) returns void language sql security invoker as $$ select app.complete_exit(p_exit) $$;
create or replace function api.submit_requisition(p_req uuid) returns uuid language sql security invoker as $$ select app.submit_requisition(p_req) $$;
create or replace function api.submit_offer(p_offer uuid) returns uuid language sql security invoker as $$ select app.submit_offer(p_offer) $$;

create or replace function api.withdraw_consent(p_consent uuid) returns void language sql security invoker as $$ select app.withdraw_consent(p_consent) $$;
create or replace function api.generate_filings(p_org uuid, p_month text) returns integer language sql security invoker as $$ select app.generate_filings(p_org, p_month) $$;

revoke execute on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated, service_role;
