import Link from 'next/link';
import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  RosterConsole, type ShiftRow, type AssignRow, type StaffLite,
} from '@/components/attendance/roster-console';

export const dynamic = 'force-dynamic';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default async function ShiftsPage({ searchParams }: { searchParams: { month?: string } }) {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : thisMonth();
  const start = `${month}-01`;
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);

  const [{ data: shifts }, { data: assigns }, { data: staff }, { data: settings }, { data: holidays }, { data: departments }] =
    await Promise.all([
      supabase
        .from('shifts')
        .select('id,name,start_time,end_time,grace_minutes,half_day_minutes,full_day_minutes,is_default')
        .eq('org_id', org)
        .order('name'),
      supabase
        .from('employee_shifts')
        .select('id,employee_id,shift_id,effective_from,effective_to')
        .eq('org_id', org)
        .order('effective_from', { ascending: false }),
      supabase
        .from('employees')
        .select('id,full_name,employee_code,department_id,status')
        .eq('org_id', org)
        .eq('status', 'active')
        .order('full_name'),
      supabase.from('org_settings').select('weekly_offs').eq('org_id', org).maybeSingle(),
      supabase.from('holidays').select('holiday_date,name').eq('org_id', org).gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('departments').select('id,name').eq('org_id', org),
    ]);

  const deptById = new Map(((departments ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  const people: StaffLite[] = ((staff ?? []) as any[]).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    employee_code: e.employee_code,
    department: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
  }));
  const byId = new Map(people.map((p) => [p.id, p]));

  const shift = (by: number) => {
    const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const label = new Date(`${start}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <CustomerShell current="/shifts">
      <PageHead
        title="Shift & Roster"
        sub="Shifts, who is on which one, and the month at a glance"
        action={
          <div className="flex items-center gap-2">
            <Link href={`/shifts?month=${shift(-1)}`} className="btn btn-sm">
              &larr;
            </Link>
            <span className="min-w-[120px] text-center text-[13px] font-semibold text-ink">{label}</span>
            <Link href={`/shifts?month=${shift(1)}`} className="btn btn-sm">
              &rarr;
            </Link>
          </div>
        }
      />
      <RosterConsole
        month={month}
        shifts={(shifts ?? []) as ShiftRow[]}
        assignments={
          ((assigns ?? []) as any[]).map((a) => ({
            ...a,
            employee_name: byId.get(a.employee_id)?.full_name ?? 'Employee',
            employee_code: byId.get(a.employee_id)?.employee_code ?? '—',
            department: byId.get(a.employee_id)?.department ?? null,
          })) as AssignRow[]
        }
        staff={people}
        weeklyOffs={((settings as any)?.weekly_offs as number[] | null) ?? [0]}
        holidays={(holidays ?? []) as { holiday_date: string; name: string }[]}
        caps={{ write: v.can('attendance.write') }}
      />
    </CustomerShell>
  );
}
