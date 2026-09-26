import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { PayslipSheet, type SlipData } from '@/components/payroll/payslip-sheet';

export const dynamic = 'force-dynamic';

/**
 * One payslip, ready to print.
 *
 * An employee can only reach a slip that has been published: payslips_select
 * scopes the row to them, and the figures come from the stored pay_run_items
 * payload rather than a recalculation, so an old slip still shows what was
 * actually paid even after rates change.
 */
export default async function MyPayslipPage({ params }: { params: { runId: string } }) {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/payroll">
        <PageHead title="Payslip" />
        <EmptyState
          icon="file"
          title="This sign-in is not linked to an employee record"
          body="Payslips belong to an employee."
        />
      </CustomerShell>
    );
  }

  const [{ data: slip }, { data: item }] = await Promise.all([
    supabase
      .from('payslips')
      .select('id,period_month,published_at')
      .eq('run_id', params.runId)
      .eq('employee_id', me)
      .maybeSingle(),
    supabase
      .from('pay_run_items')
      .select('paid_days,lop_days,gross,total_deductions,net,payload')
      .eq('run_id', params.runId)
      .eq('employee_id', me)
      .maybeSingle(),
  ]);

  if (!slip || !item) notFound();

  const [{ data: emp }, { data: stat }, { data: org }] = await Promise.all([
    supabase
      .from('employees')
      .select('full_name,employee_code,doj,department_id,designation_id,location_id,entity_id')
      .eq('id', me)
      .maybeSingle(),
    supabase
      .from('employee_statutory')
      .select('uan,esi_ip_number,pan_last4,bank_last4,bank_name')
      .eq('employee_id', me)
      .maybeSingle(),
    supabase.from('organizations').select('name,pan').eq('id', v.orgId ?? '').maybeSingle(),
  ]);

  const e = (emp ?? {}) as any;
  const [{ data: dept }, { data: desig }, { data: loc }, { data: entity }] = await Promise.all([
    e.department_id ? supabase.from('departments').select('name').eq('id', e.department_id).maybeSingle() : Promise.resolve({ data: null }),
    e.designation_id ? supabase.from('designations').select('title').eq('id', e.designation_id).maybeSingle() : Promise.resolve({ data: null }),
    e.location_id ? supabase.from('locations').select('name,city').eq('id', e.location_id).maybeSingle() : Promise.resolve({ data: null }),
    e.entity_id ? supabase.from('legal_entities').select('name,pan').eq('id', e.entity_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const p = ((item as any).payload ?? {}) as any;
  const s = (stat ?? {}) as any;

  const data: SlipData = {
    employee: {
      name: e.full_name ?? 'Employee',
      code: e.employee_code ?? '—',
      designation: (desig as any)?.title ?? null,
      department: (dept as any)?.name ?? null,
      location: (loc as any) ? `${(loc as any).name}${(loc as any).city ? `, ${(loc as any).city}` : ''}` : null,
      doj: e.doj ?? null,
      uan: s.uan ?? null,
      esiIp: s.esi_ip_number ?? null,
      panLast4: s.pan_last4 ?? null,
      bankLast4: s.bank_last4 ?? null,
      bankName: s.bank_name ?? null,
    },
    employer: {
      name: (entity as any)?.name ?? (org as any)?.name ?? 'Employer',
      pan: (entity as any)?.pan ?? (org as any)?.pan ?? null,
    },
    month: (slip as any).period_month,
    paidDays: Number((item as any).paid_days ?? 0),
    totalDays: Number(p.totalDays ?? 0),
    lopDays: Number((item as any).lop_days ?? 0),
    earnings: (p.earnings ?? []) as SlipData['earnings'],
    reimbursements: (p.reimbursements ?? []) as SlipData['reimbursements'],
    deductions: (p.deductions ?? []) as SlipData['deductions'],
    employerContributions: (p.employerContributions ?? []) as SlipData['employerContributions'],
    gross: Number((item as any).gross ?? 0),
    totalDeductions: Number((item as any).total_deductions ?? 0),
    net: Number((item as any).net ?? 0),
    ytd: (p.nextYtd ?? null) as Record<string, number> | null,
    publishedAt: (slip as any).published_at,
  };

  return (
    <CustomerShell current="/me/payroll">
      <div className="no-print">
        <PageHead
          title="Payslip"
          sub="Print it, or save it as a PDF from the print dialog"
          action={
            <Link href="/me/payroll" className="btn">
              All payslips
            </Link>
          }
        />
      </div>
      <PayslipSheet slip={data} />
    </CustomerShell>
  );
}
