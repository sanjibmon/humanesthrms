#!/usr/bin/env bash
# Mutation check for the security tests: weaken one rule at a time and confirm the suite notices.
# A mutation that leaves the suite green means a missing test. Run: bash tests/mutation.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mutate() { # name file python-regex-old python-new
  local name=$1 file=$2 old=$3 new=$4 tmp; tmp=$(mktemp -d); cp -r "$ROOT/." "$tmp/"
  if ! OLD="$old" NEW="$new" F="$tmp/migrations/$file" python3 - <<'PY'
import os,sys,re
p=os.environ['F']; s=open(p).read(); o=os.environ['OLD']; n=os.environ['NEW']
if o not in s: sys.exit(3)
open(p,'w').write(s.replace(o,n,1))
PY
  then echo "SKIP   $name (pattern not found)"; rm -rf "$tmp"; return; fi
  if bash "$tmp/tests/run.sh" >/dev/null 2>&1; then echo "SURVIVED  $name   <-- add a test"; else echo "killed    $name"; fi
  rm -rf "$tmp"
}
mutate "platform staff no longer need MFA"          0002_platform_catalog.sql "select app.aal2() and exists (
    select 1
    from public.platform_users u" "select exists (
    select 1
    from public.platform_users u"
mutate "statutory ids readable without MFA"          0004_people.sql "using (app.can_mfa(org_id, 'people.sensitive.read') or (app.aal2() and employee_id = app.my_employee_id(org_id)));" "using (app.can(org_id, 'people.sensitive.read') or employee_id = app.my_employee_id(org_id));"
mutate "directory visible across tenants"             0004_people.sql "create policy employees_select on public.employees for select to authenticated
  using (org_id in (select app.user_org_ids()) or app.has_support_grant(org_id));" "create policy employees_select on public.employees for select to authenticated
  using (true);"
mutate "support grant never expires"                  0003_tenancy.sql "and now() between g.starts_at and g.expires_at" "and now() >= g.starts_at"
mutate "support sees personal data"                   0004_people.sql "create policy personal_select on public.employee_personal for select to authenticated
  using (app.can(org_id, 'people.read') or employee_id = app.my_employee_id(org_id));" "create policy personal_select on public.employee_personal for select to authenticated
  using (app.can_read(org_id, 'people.read') or employee_id = app.my_employee_id(org_id));"
mutate "maker-checker removed from pay run approval" 0006_payroll.sql "if mc and r.created_by is not distinct from app.uid() then" "if false then"
mutate "employee sees unpublished payslip data"       0006_payroll.sql "             and exists (select 1 from public.payslips p where p.run_id = pay_run_items.run_id and p.employee_id = pay_run_items.employee_id)))" "             ))"
mutate "employee compensation drafts visible"         0006_payroll.sql "or (employee_id = app.my_employee_id(org_id) and status = 'approved'));" "or employee_id = app.my_employee_id(org_id));"
mutate "leave overlap check removed"                  0005_time_leave_approvals.sql "raise exception 'OVERLAP: you already have leave in this period';" "null;"
mutate "self approval allowed"                        0005_time_leave_approvals.sql "if me is not null and me = r.requester_employee_id then" "if false then"
mutate "seat limit not enforced"                      0004_people.sql "if used + 1 > l.seats_total then" "if false then"
mutate "org owner can change own status"              0003_tenancy.sql "if app.platform_can('manage_customers') or current_user in ('postgres', 'service_role') then" "if true then"
mutate "audit rows editable"                          0001_foundation.sql "raise exception 'Table % is append-only', tg_table_name using errcode = '42501';" "return coalesce(new, old);"
mutate "geofence trusts the client"                   0005_time_leave_approvals.sql "  new.inside_geofence := null;
  new.distance_m := null;" "  null;"
mutate "reveal needs no permission"                   0004_people.sql "allowed := app.aal2() and (app.can(org, 'pii.reveal') or emp = app.my_employee_id(org));" "allowed := true;"
mutate "locked runs can be edited"                    0006_payroll.sql "if st is not null and st not in ('draft','computed') then" "if false then"
mutate "POSH visible to HR"                           0008_compliance_security.sql "using (app.can_mfa(org_id, 'posh.manage') or complainant_employee_id = app.my_employee_id(org_id));" "using (app.can_mfa(org_id, 'people.write') or app.can_mfa(org_id, 'posh.manage') or complainant_employee_id = app.my_employee_id(org_id));"
mutate "module gate removed"                          0007_talent_service_modules.sql "create trigger trg_gate_recruit1 before insert on public.job_requisitions for each row execute function app.require_module('recruitment');" "-- removed"
