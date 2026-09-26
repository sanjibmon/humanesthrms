import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { inr, dateLabel } from '@/lib/format';
import { PayrollConsole, type RunRow, type StructureRow, type DraftCompRow } from '@/components/payroll/payroll-console';
import type { VDecl } from '@/components/payroll/tax-verification';
import { fyStartOf } from '@/lib/tax-sections';

export const dynamic = 'force-dynamic';

export default async function PayrollPage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  const fyStart = fyStartOf();

  const [
    { data: runs }, { data: structures }, { data: comp }, { data: entities }, { data: rules },
    { data: decls }, { data: staff }, { data: priors },
  ] = await Promise.all([
      supabase
        .from('pay_runs')
        .select('id,period_month,run_type,status,entity_id,totals,computed_at,approved_at,locked_at,paid_at,created_at')
        .eq('org_id', org)
        .order('period_month', { ascending: false })
        .limit(24),
      supabase.from('salary_structures').select('id,code,name,is_active,template').eq('org_id', org).order('code'),
      supabase
        .from('employee_compensation')
        .select('id,employee_id,annual_ctc,effective_from,grade,status')
        .eq('org_id', org)
        .eq('status', 'draft')
        .order('effective_from', { ascending: false })
        .limit(50),
      supabase.from('legal_entities').select('id,name').eq('org_id', org).order('name'),
      supabase
        .from('statutory_rules')
        .select('rule_key,value,status,effective_from,source')
        .order('effective_from', { ascending: false }),
      supabase
        .from('tax_declarations')
        .select('id,employee_id,fy_start,regime,status,submitted_at,verified_at,tax_declaration_items(id,section,description,declared_amount,verified_amount,city,status)')
        .eq('org_id', org)
        .eq('fy_start', fyStart)
        .order('submitted_at', { ascending: true, nullsFirst: false }),
      supabase
        .from('employees')
        .select('id,full_name,employee_code,status')
        .eq('org_id', org)
        .eq('status', 'active')
        .order('full_name'),
      supabase.from('prior_employer_income').select('employee_id,income,tds').eq('org_id', org).eq('fy_start', fyStart),
    ]);

  /* Compensation rows carry an employee id, not a name. */
  const compRows = (comp ?? []) as any[];
  const ids = compRows.map((c) => c.employee_id).filter(Boolean);
  const { data: emps } = ids.length
    ? await supabase.from('employees').select('id,full_name,employee_code').in('id', ids)
    : { data: [] as unknown[] };
  const nameById = new Map(((emps ?? []) as any[]).map((e) => [e.id as string, e]));

  /* Declarations carry an employee id and a regime the employee asked for; the
     regime payroll actually applies lives on employee_statutory, so both are
     read and the screen shows the gap rather than hiding it. */
  const staffRows = (staff ?? []) as any[];
  const staffById = new Map(staffRows.map((e) => [e.id as string, e]));
  const declRows = (decls ?? []) as any[];
  const declEmpIds = declRows.map((d) => d.employee_id).filter(Boolean);
  const { data: stats } = declEmpIds.length
    ? await supabase.from('employee_statutory').select('employee_id,tax_regime').in('employee_id', declEmpIds)
    : { data: [] as unknown[] };
  const regimeById = new Map(((stats ?? []) as any[]).map((s) => [s.employee_id as string, s.tax_regime as string]));
  const priorById = new Map(((priors ?? []) as any[]).map((p) => [p.employee_id as string, p]));

  const declarations: VDecl[] = declRows.map((d) => ({
    id: d.id,
    employee_id: d.employee_id,
    employee_name: staffById.get(d.employee_id)?.full_name ?? nameById.get(d.employee_id)?.full_name ?? 'Employee',
    employee_code: staffById.get(d.employee_id)?.employee_code ?? '—',
    fy_start: d.fy_start,
    regime: d.regime,
    status: d.status,
    submitted_at: d.submitted_at,
    verified_at: d.verified_at,
    statutory_regime: regimeById.get(d.employee_id) ?? null,
    items: (d.tax_declaration_items ?? []) as VDecl['items'],
    prior: priorById.has(d.employee_id)
      ? { income: Number(priorById.get(d.employee_id).income), tds: Number(priorById.get(d.employee_id).tds) }
      : null,
  }));

  const entityById = new Map(((entities ?? []) as any[]).map((e) => [e.id as string, e.name as string]));
  const announced = ((rules ?? []) as any[]).find((r) => r.status === 'announced');
  const inForce = ((rules ?? []) as any[]).filter((r) => r.status === 'in_force').slice(0, 10);

  return (
    <CustomerShell current="/payroll">
      <PageHead
        title="Payroll"
        sub="Salary structures, pay runs and Indian statutory compliance"
      />

      {announced ? (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span className="shrink-0">
            <Icon name="alert" size={18} />
          </span>
          <span>
            <b>
              {announced.rule_key} of {inr(Number(announced.value))} is announced, not yet in force.
            </b>{' '}
            Payroll keeps using the in-force value until the notification gives an effective date.
            {announced.source ? ` Source: ${announced.source}` : ''}
          </span>
        </div>
      ) : null}

      <PayrollConsole
        runs={((runs ?? []) as any[]).map((r) => ({
          ...r,
          entity_name: r.entity_id ? (entityById.get(r.entity_id) ?? null) : null,
        })) as RunRow[]}
        structures={(structures ?? []) as StructureRow[]}
        draftComp={
          compRows.map((c) => ({
            id: c.id,
            employee_name: nameById.get(c.employee_id)?.full_name ?? 'Employee',
            annual_ctc: Number(c.annual_ctc),
            effective_from: c.effective_from,
            grade: c.grade,
          })) as DraftCompRow[]
        }
        entities={((entities ?? []) as any[]).map((e) => ({ value: e.id, label: e.name }))}
        declarations={declarations}
        employees={staffRows.map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_code})` }))}
        fyStart={fyStart}
        caps={{ run: v.can('payroll.run'), config: v.can('payroll.config') }}
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm">Statutory parameters in force</h3>
          {inForce.length === 0 ? (
            <p className="text-xs text-slate-muted">None published yet.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
              {inForce.map((r) => (
                <div key={`${r.rule_key}-${r.effective_from}`} className="contents">
                  <dt className="text-xs text-slate-muted">{r.rule_key}</dt>
                  <dd className="font-medium tabular-nums text-ink">
                    {String(r.value)}{' '}
                    <span className="text-[11px] font-normal text-slate-muted">
                      from {dateLabel(r.effective_from)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-muted">
            Rates are effective-dated data, not code. A change is published, not released — and the
            parameters a run actually used are stored with it, so an old payslip still reproduces.
          </p>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm">How a run moves</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {['Draft', 'Computed', 'Approved', 'Locked', 'Paid'].map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                {i ? <span className="text-slate-faint">&rarr;</span> : null}
                <span className="badge">{s}</span>
              </span>
            ))}
          </div>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-slate-muted">
            <li>Approval needs a different person from whoever computed the run.</li>
            <li>Locking freezes the attendance behind it and posts loan instalments.</li>
            <li>Payslips can only be published once a run is locked.</li>
            <li>A reopen is allowed from approved only, and the reason is audited.</li>
          </ul>
        </div>
      </div>
    </CustomerShell>
  );
}
