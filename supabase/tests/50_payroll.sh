#!/usr/bin/env bash
# End-to-end payroll: database inputs -> TypeScript engine -> database, with role checks at every step.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=${PGHOST:-/tmp/pgtest} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=hn_test
ENGINE=../packages/payroll-engine
TMP=$(mktemp -d)
P="psql -d $DB -At -q -v ON_ERROR_STOP=1"

U_OWNER=00000000-0000-0000-0000-0000000000b1; U_HR=00000000-0000-0000-0000-0000000000b2; U_MGR=00000000-0000-0000-0000-0000000000b3
U_E1=00000000-0000-0000-0000-0000000000b4;    U_E2=00000000-0000-0000-0000-0000000000b5; U_PAY=00000000-0000-0000-0000-0000000000b6
U_AUD=00000000-0000-0000-0000-0000000000b7;   U_FIN=00000000-0000-0000-0000-0000000000b8; U_SUP=00000000-0000-0000-0000-0000000000a2

# as <user> <aal> <sql...>: run SQL as a signed-in user (stdin-free, one session)
as() { local u=$1 a=$2; shift 2; printf "select t.login('%s','%s') \\\\gset\n%s\n" "$u" "$a" "$*" | $P; }
# raw <sql>: run as the database owner
raw() { echo "$*" | $P; }
# check <name> <expected> <actual>
norm() { case "$1" in t) echo true;; f) echo false;; *) if [[ "$1" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then awk -v x="$1" 'BEGIN{printf "%.4f", x}'; else echo "$1"; fi;; esac; }
check() { local ok=false n="${1//\'/\'\'}" d; [ "$(norm "$2")" = "$(norm "$3")" ] && ok=true; d="expected ${2//\'/\'\'} got ${3//\'/\'\'}";
  raw "insert into t.results (name, ok, detail) values ('$n', $ok, $( [ $ok = true ] && echo null || echo "'$d'" ))"; }
# fails <name> <fragment> <user> <aal> <sql>: the statement must be rejected and the error must contain the fragment
fails() { local n=$1 f=$2 u=$3 a=$4; shift 4; local out; if out=$(as "$u" "$a" "$@" 2>&1); then check "$n" "error" "succeeded"; else
    case "$out" in *"$f"*) check "$n" ok ok;; *) check "$n" "error containing '$f'" "$(echo "$out" | head -1 | tr "'" ' ')";; esac; fi; }

A=$(raw "select v from t.ids where k='orgA'")
E1=$(raw "select v from t.ids where k='e1'"); E2=$(raw "select v from t.ids where k='e2'"); MGR=$(raw "select v from t.ids where k='mgr'")

# ---------- entitlement: loans module is off until HumaNest enables it ----------
fails "gate: loans cannot be created before the module is enabled" "module is not enabled" $U_PAY aal2 "insert into public.loans (org_id, employee_id, kind, principal, emi, start_month, outstanding) values ('$(raw "select v from t.ids where k='orgA'")','$(raw "select v from t.ids where k='e2'")','loan',1,1,'2026-09',1)"
raw "update public.organization_modules set enabled = true where module_code in ('loans','statutory') and org_id = (select v from t.ids where k='orgA')"

# ---------- setup (as owner role): a finance approver, a salary structure, an old-regime declaration flag ----------
raw "insert into auth.users (id, email) values ('$U_FIN','fin@acme.test')"
raw "insert into public.org_members (org_id, user_id, role) values ('$A','$U_FIN','finance_approver')"
TPL=$(cd $ENGINE && node --experimental-strip-types -e "import('./src/structure.ts').then(m=>process.stdout.write(JSON.stringify(m.defaultTemplate('M1',{metro:false}))))")
raw "insert into public.salary_structures (org_id, code, name, template) values ('$A','M1','Standard grade M1', \$j\$$TPL\$j\$::jsonb)"
STRUCT=$(raw "select id from public.salary_structures where org_id='$A' and code='M1'")

# ---------- compensation: maker-checker ----------
as $U_PAY aal2 "insert into public.employee_compensation (org_id, employee_id, effective_from, annual_ctc, structure_id, grade, revision_reason) values
  ('$A','$E1','2026-04-01',1200000,'$STRUCT','M1','Joining'), ('$A','$E2','2026-04-01',420000,'$STRUCT','M1','Joining'), ('$A','$MGR','2026-04-01',2400000,'$STRUCT','M1','Joining');" >/dev/null
fails "comp: creator cannot approve own salary" "Maker-checker" $U_PAY aal2 "update public.employee_compensation set status='approved'"
fails "comp: payroll admin without MFA is refused" "row-level security" $U_PAY aal1 "insert into public.employee_compensation (org_id, employee_id, effective_from, annual_ctc, structure_id) values ('$A','$E1','2027-04-01',1,'$STRUCT')"
check "comp: employee cannot see own draft" 0 "$(as $U_E1 aal1 "select count(*) from public.employee_compensation")"
as $U_OWNER aal2 "update public.employee_compensation set status='approved'" >/dev/null
check "comp: owner approved three rows" 3 "$(raw "select count(*) from public.employee_compensation where status='approved' and approved_by='$U_OWNER'")"
fails "comp: approved salary cannot be edited" "immutable" $U_OWNER aal2 "update public.employee_compensation set annual_ctc = 9999999 where employee_id='$E1'"
check "comp: employee sees only own approved salary" 1 "$(as $U_E1 aal1 "select count(*) from public.employee_compensation")"
check "comp: manager sees no salaries but own" 1 "$(as $U_MGR aal1 "select count(*) from public.employee_compensation")"
check "comp: HR without payroll permission sees none" 0 "$(as $U_HR aal2 "select count(*) from public.employee_compensation")"
check "comp: auditor with MFA reads all" 3 "$(as $U_AUD aal2 "select count(*) from public.employee_compensation")"
check "comp: auditor without MFA reads none" 0 "$(as $U_AUD aal1 "select count(*) from public.employee_compensation")"

# ---------- inputs for the run: adjustments, a loan, tax declaration ----------
as $U_PAY aal2 "insert into public.pay_adjustments (org_id, employee_id, period_month, kind, description, amount) values ('$A','$MGR','2026-09','incentive','Q2 incentive',5000)" >/dev/null
as $U_PAY aal2 "insert into public.loans (org_id, employee_id, kind, principal, emi, start_month, outstanding) values ('$A','$E2','loan',10000,2000,'2026-09',10000)" >/dev/null
check "adj: employee cannot create adjustments" "denied" "$(as $U_E1 aal1 "insert into public.pay_adjustments (org_id, employee_id, period_month, kind, description, amount) values ('$A','$E1','2026-09','incentive','x',1)" 2>&1 | grep -c 'row-level security' | sed 's/1/denied/')"
raw "update public.employee_statutory set tax_regime='old' where employee_id='$MGR'" 2>/dev/null || raw "insert into public.employee_statutory (employee_id, org_id, tax_regime) values ('$MGR','$A','old')"
# employee files a declaration (aal1: ESS does not need step-up for own tax data)
as $U_E1 aal1 "insert into public.tax_declarations (org_id, employee_id, fy_start, regime, status) values ('$A','$E1',2026,'new','draft'); insert into public.tax_declaration_items (org_id, declaration_id, section, declared_amount) select org_id, id, '80c', 150000 from public.tax_declarations where employee_id='$E1'" >/dev/null
as $U_E1 aal1 "update public.tax_declarations set status='submitted'" >/dev/null
check "tax: employee sees own declaration" 1 "$(as $U_E1 aal1 "select count(*) from public.tax_declaration_items")"
check "tax: colleague cannot see it" 0 "$(as $U_E2 aal1 "select count(*) from public.tax_declaration_items")"
fails "tax: employee cannot self-accept a proof" "Only payroll can accept" $U_E1 aal1 "update public.tax_declaration_items set status='accepted'"
fails "tax: cannot file for a colleague" "row-level security" $U_E1 aal1 "insert into public.tax_declarations (org_id, employee_id, fy_start) values ('$A','$E2',2026)"
check "tax: payroll sees the declaration" 1 "$(as $U_PAY aal2 "select count(*) from public.tax_declaration_items")"

# ---------- run 1: create -> inputs -> engine -> save ----------
RUN=$(as $U_PAY aal2 "select app.create_pay_run('$A','2026-09')")
fails "run: second regular run for the same month refused" "duplicate key" $U_PAY aal2 "select app.create_pay_run('$A','2026-09')"
fails "run: HR cannot create a pay run" "Not permitted" $U_HR aal2 "select app.create_pay_run('$A','2026-10')"
fails "run: payroll without MFA cannot create a pay run" "Not permitted" $U_PAY aal1 "select app.create_pay_run('$A','2026-10')"
as $U_PAY aal2 "select app.payroll_inputs('$RUN')" > $TMP/inputs.json
check "inputs: three employees have compensation" 3 "$(jq '.employees | length' $TMP/inputs.json)"
check "inputs: four employees skipped with a reason" 4 "$(jq '[.skipped[] | select(.reason=="no approved compensation")] | length' $TMP/inputs.json)"
check "inputs: incentive flows through" 5000 "$(jq '.employees[] | select(.code=="A002") | .variable.incentives' $TMP/inputs.json)"
check "inputs: loan EMI flows through" 2000 "$(jq '.employees[] | select(.code=="A004") | .deductions.loanEmi' $TMP/inputs.json)"
check "inputs: declaration flows through for the employee" 150000 "$(jq '.employees[] | select(.code=="A003") | .declarations.c80' $TMP/inputs.json)"
check "inputs: work state comes from location" MH "$(jq -r '.employees[] | select(.code=="A003") | .state' $TMP/inputs.json)"
check "inputs: full month paid days" 30 "$(jq '.employees[] | select(.code=="A003") | .calendar.paidDays' $TMP/inputs.json)"
check "inputs: inputs never carry bank details" 0 "$(grep -c -i 'bank\|pan_enc\|account' $TMP/inputs.json || true)"
fails "inputs: employee cannot fetch payroll inputs" "Not permitted" $U_E1 aal2 "select app.payroll_inputs('$RUN')"
fails "inputs: manager cannot fetch payroll inputs" "Not permitted" $U_MGR aal2 "select app.payroll_inputs('$RUN')"

(cd $ENGINE && node --experimental-strip-types scripts/run_from_stdin.ts < $TMP/inputs.json) > $TMP/out.json
jq -c '.items' $TMP/out.json > $TMP/items.json; jq -c '.params' $TMP/out.json > $TMP/params.json; VER=$(jq -r '.engineVersion' $TMP/out.json)
check "engine: three payslips computed" 3 "$(jq 'length' $TMP/items.json)"
as $U_PAY aal2 "select app.save_pay_run_items('$RUN', \$j\$$(cat $TMP/items.json)\$j\$::jsonb, \$j\$$(cat $TMP/params.json)\$j\$::jsonb, '$VER')" >/dev/null
check "run: status computed" computed "$(raw "select status from public.pay_runs where id='$RUN'")"
check "run: parameters snapshot stored" 15000 "$(raw "select params_snapshot->'pf'->>'wageCeiling' from public.pay_runs where id='$RUN'")"
check "run: totals equal the sum of items" true "$(raw "select (totals->>'net')::numeric = (select sum(net) from public.pay_run_items where run_id='$RUN') from public.pay_runs where id='$RUN'")"
check "run: every item reconciles gross - deductions = net" 0 "$(raw "select count(*) from public.pay_run_items where round(gross - total_deductions, 2) <> net")"
check "run: employee PF is 12% of the 15000 ceiling" 1800.00 "$(raw "select pf_employee from public.pay_run_items where employee_id='$E1'")"
check "run: Maharashtra PT for a woman above 25000 is 200" 200.00 "$(raw "select pt from public.pay_run_items where employee_id='$E1'")"
check "run: Maharashtra PT for a man is 200" 200.00 "$(raw "select pt from public.pay_run_items where employee_id='$E2'")"
check "run: 12L CTC under the new regime has no TDS (87A rebate)" 0.00 "$(raw "select tds from public.pay_run_items where employee_id='$E1'")"
check "run: 24L CTC (old regime, no declarations) has TDS" true "$(raw "select tds > 0 from public.pay_run_items where employee_id='$MGR'")"
check "run: loan EMI deducted from the employee" true "$(raw "select (payload->'deductions') @> '[{\"code\":\"LOAN\"}]'::jsonb or total_deductions > 2000 from public.pay_run_items where employee_id='$E2'")"
check "run: employer cost exceeds gross" true "$(raw "select bool_and(employer_cost >= gross) from public.pay_run_items where run_id='$RUN'")"

# ---------- access to run data ----------
check "access: employee sees no items before publishing" 0 "$(as $U_E1 aal1 "select count(*) from public.pay_run_items")"
check "access: HR without payroll permission sees no runs" 0 "$(as $U_HR aal2 "select count(*) from public.pay_runs")"
check "access: manager sees no runs" 0 "$(as $U_MGR aal2 "select count(*) from public.pay_runs")"
check "access: payroll without MFA sees no runs" 0 "$(as $U_PAY aal1 "select count(*) from public.pay_runs")"
check "access: payroll with MFA sees the run" 1 "$(as $U_PAY aal2 "select count(*) from public.pay_runs")"
fails "access: direct status update is refused" "permission denied" $U_PAY aal2 "update public.pay_runs set status='paid'"
fails "access: direct insert of items is refused" "permission denied" $U_PAY aal2 "insert into public.pay_run_items (org_id, run_id, employee_id, paid_days, gross, total_deductions, net, payload) values ('$A','$RUN','$E1',30,1,0,1,'{}')"

# ---------- approval: maker-checker and separation of duties ----------
fails "approve: payroll admin lacks payroll.approve" "Not permitted" $U_PAY aal2 "select app.approve_pay_run('$RUN')"
fails "approve: finance approver needs MFA" "Not permitted" $U_FIN aal1 "select app.approve_pay_run('$RUN')"
as $U_OWNER aal2 "select app.create_pay_run('$A','2026-11')" > $TMP/run3
RUN3=$(cat $TMP/run3)
as $U_OWNER aal2 "select app.save_pay_run_items('$RUN3', \$j\$$(cat $TMP/items.json)\$j\$::jsonb, '{}'::jsonb, '$VER')" >/dev/null
fails "approve: same person who computed cannot approve (maker-checker)" "Maker-checker" $U_OWNER aal2 "select app.approve_pay_run('$RUN3')"
as $U_FIN aal2 "select app.approve_pay_run('$RUN')" >/dev/null
check "approve: run approved by finance" approved "$(raw "select status from public.pay_runs where id='$RUN'")"
fails "approve: an approved run cannot be recomputed" "can no longer be recomputed" $U_PAY aal2 "select app.save_pay_run_items('$RUN', '[]'::jsonb, '{}'::jsonb, 'x')"
OUT=$(raw "update public.pay_run_items set net = 1 where run_id='$RUN'" 2>&1 || true)
case "$OUT" in *"cannot be changed"*) check "approve: items frozen even for the owner role" ok ok;; *) check "approve: items frozen even for the owner role" ok "$OUT";; esac
fails "approve: cannot lock before approval of another run" "Only an approved" $U_FIN aal2 "select app.lock_pay_run('$RUN3')"
fails "approve: cannot publish payslips before lock" "only after the run is locked" $U_PAY aal2 "select app.publish_payslips('$RUN')"
as $U_FIN aal2 "select app.lock_pay_run('$RUN')" >/dev/null
check "lock: run locked" locked "$(raw "select status from public.pay_runs where id='$RUN'")"
check "lock: adjustment consumed" applied "$(raw "select status from public.pay_adjustments where employee_id='$MGR'")"
check "lock: loan reduced by one EMI" 8000.00 "$(raw "select outstanding from public.loans where employee_id='$E2'")"
check "lock: repayment recorded" 1 "$(raw "select count(*) from public.loan_repayments where run_id='$RUN'")"
fails "lock: a locked run cannot be reopened" "Only an approved" $U_FIN aal2 "select app.reopen_pay_run('$RUN','mistake found')"

# ---------- payslip publication and employee self-service ----------
check "publish: three payslips published" 3 "$(as $U_PAY aal2 "select app.publish_payslips('$RUN')")"
check "publish: idempotent" 0 "$(as $U_PAY aal2 "select app.publish_payslips('$RUN')")"
check "ess: employee sees exactly own payslip" 1 "$(as $U_E1 aal1 "select count(*) from public.payslips")"
check "ess: employee sees exactly own payslip data" 1 "$(as $U_E1 aal1 "select count(*) from public.pay_run_items")"
check "ess: employee cannot read colleague's figures" 0 "$(as $U_E1 aal1 "select count(*) from public.pay_run_items where employee_id='$E2'")"
check "ess: manager sees only own payslip" 1 "$(as $U_MGR aal1 "select count(*) from public.payslips")"
check "ess: HR without payroll permission sees no payslips" 0 "$(as $U_HR aal2 "select count(*) from public.payslips")"
check "ess: auditor with MFA sees all payslips" 3 "$(as $U_AUD aal2 "select count(*) from public.payslips")"
check "ess: employee sees own loan" 0 "$(as $U_E1 aal1 "select count(*) from public.loans")"
check "ess: borrower sees own loan" 1 "$(as $U_E2 aal1 "select count(*) from public.loans")"

# ---------- support and cross-tenant ----------
raw "insert into public.support_access_grants (org_id, platform_user_id, reason, approved_by, approved_at, starts_at, expires_at) values ('$A','$U_SUP','Investigating a payslip query','$U_OWNER',now(),now(),now()+interval '2 hours')"
check "support: even with an approved grant, no pay runs" 0 "$(as $U_SUP aal2 "select count(*) from public.pay_runs")"
check "support: even with an approved grant, no compensation" 0 "$(as $U_SUP aal2 "select count(*) from public.employee_compensation")"
check "support: even with an approved grant, no payslips" 0 "$(as $U_SUP aal2 "select count(*) from public.payslips")"
check "tenant: other organisation's owner sees no Acme payroll" 0 "$(as 00000000-0000-0000-0000-0000000000c1 aal2 "select count(*) from public.pay_runs")"

# ---------- pay and next month chain ----------
fails "paid: payroll admin cannot mark paid" "Not permitted" $U_PAY aal2 "select app.mark_pay_run_paid('$RUN')"
as $U_FIN aal2 "select app.mark_pay_run_paid('$RUN')" >/dev/null
check "paid: run paid" paid "$(raw "select status from public.pay_runs where id='$RUN'")"
RUN2=$(as $U_PAY aal2 "select app.create_pay_run('$A','2026-10')")
as $U_PAY aal2 "select app.payroll_inputs('$RUN2')" > $TMP/inputs2.json
SEP_YTD=$(jq -cS '.items[] | select(.code=="A002") | .nextYtd' $TMP/out.json)
OCT_YTD=$(jq -cS '.employees[] | select(.code=="A002") | .ytd' $TMP/inputs2.json)
check "chain: October opens with September's year-to-date" "$SEP_YTD" "$OCT_YTD"
check "chain: loan EMI continues in October" 2000 "$(jq '.employees[] | select(.code=="A004") | .deductions.loanEmi' $TMP/inputs2.json)"
check "chain: applied incentive is not paid twice" 0 "$(jq '.employees[] | select(.code=="A002") | .variable.incentives' $TMP/inputs2.json)"
(cd $ENGINE && node --experimental-strip-types scripts/run_from_stdin.ts < $TMP/inputs2.json) > $TMP/out2.json
check "chain: October TDS for the 24L employee is positive" true "$(jq '[.items[] | select(.code=="A002")][0].tds.tdsThisMonth > 0' $TMP/out2.json)"
rm -rf $TMP
