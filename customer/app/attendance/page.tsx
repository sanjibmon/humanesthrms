import Link from 'next/link';
import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  AttendanceConsole,
  type DayRow, type StaffRow, type RegRow, type EventRow, type DeviceRow,
} from '@/components/attendance/attendance-console';

export const dynamic = 'force-dynamic';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : thisMonth();
  const start = `${month}-01`;
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);

  const [
    { data: staff }, { data: days }, { data: regs }, { data: events },
    { data: devices }, { data: locations }, { data: holidays },
    { data: departments },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select('id,full_name,employee_code,department_id,location_id,status')
      .eq('org_id', org)
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('attendance_daily')
      .select('employee_id,work_date,first_in,last_out,worked_minutes,status,late_minutes,overtime_minutes,overtime_approved_minutes,source,is_regularized,locked')
      .eq('org_id', org)
      .gte('work_date', start)
      .lte('work_date', end),
    supabase
      .from('attendance_regularizations')
      .select('id,employee_id,work_date,request_type,requested_in,requested_out,reason,status,approval_request_id,created_at')
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('attendance_events')
      .select('id,employee_id,event_time,event_type,source,inside_geofence,distance_m,is_mock_location,flags')
      .eq('org_id', org)
      .gte('event_time', `${start}T00:00:00Z`)
      .order('event_time', { ascending: false })
      .limit(120),
    supabase.from('attendance_devices').select('id,name,device_type,vendor,serial_no,status,last_sync_at,location_id').eq('org_id', org).order('name'),
    supabase.from('locations').select('id,name').eq('org_id', org).order('name'),
    supabase.from('holidays').select('holiday_date,name').eq('org_id', org).gte('holiday_date', start).lte('holiday_date', end),
    supabase.from('departments').select('id,name').eq('org_id', org),
  ]);

  const deptById = new Map(((departments ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  const locById = new Map(((locations ?? []) as any[]).map((l) => [l.id as string, l.name as string]));

  const people = ((staff ?? []) as any[]).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    employee_code: e.employee_code,
    department: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
    location: e.location_id ? (locById.get(e.location_id) ?? null) : null,
  })) as StaffRow[];

  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Employee';

  /* The month picker is a link rather than client state so a month someone is
     looking at can be shared, bookmarked and reloaded. */
  const shift = (by: number) => {
    const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const label = new Date(`${start}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <CustomerShell current="/attendance">
      <PageHead
        title="Attendance"
        sub="The daily register, corrections, punches and readers"
        action={
          <div className="flex items-center gap-2">
            <Link href={`/attendance?month=${shift(-1)}`} className="btn btn-sm">
              &larr;
            </Link>
            <span className="min-w-[120px] text-center text-[13px] font-semibold text-ink">{label}</span>
            <Link href={`/attendance?month=${shift(1)}`} className="btn btn-sm">
              &rarr;
            </Link>
          </div>
        }
      />
      <AttendanceConsole
        month={month}
        days={(days ?? []) as DayRow[]}
        staff={people}
        regs={((regs ?? []) as any[]).map((r) => ({ ...r, employee_name: nameOf(r.employee_id) })) as RegRow[]}
        events={((events ?? []) as any[]).map((e) => ({ ...e, employee_name: nameOf(e.employee_id) })) as EventRow[]}
        devices={(devices ?? []) as DeviceRow[]}
        locations={((locations ?? []) as any[]).map((l) => ({ value: l.id, label: l.name }))}
        holidays={(holidays ?? []) as { holiday_date: string; name: string }[]}
        caps={{ write: v.can('attendance.write'), approve: v.can('attendance.approve') }}
      />
    </CustomerShell>
  );
}
