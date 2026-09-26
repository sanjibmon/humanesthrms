'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Kpi, EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { assignShift, endShiftAssignment } from '@/app/actions/attendance';
import { saveShift } from '@/app/actions/settings';

export type ShiftRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  half_day_minutes: number;
  full_day_minutes: number;
  is_default: boolean;
};

export type AssignRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string | null;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
};

export type StaffLite = { id: string; full_name: string; employee_code: string; department: string | null };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const hhmm = (t: string) => (t ?? '').slice(0, 5);

export function RosterConsole({
  month,
  shifts,
  assignments,
  staff,
  weeklyOffs,
  holidays,
  caps,
}: {
  month: string;
  shifts: ShiftRow[];
  assignments: AssignRow[];
  staff: StaffLite[];
  weeklyOffs: number[];
  holidays: { holiday_date: string; name: string }[];
  caps: { write: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ kind: string; shift?: ShiftRow; row?: AssignRow } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.holiday_date, h.name])), [holidays]);
  const departments = useMemo(
    () => [...new Set(staff.map((s) => s.department).filter(Boolean) as string[])].sort(),
    [staff],
  );
  const visible = useMemo(() => (dept ? staff.filter((s) => s.department === dept) : staff), [staff, dept]);

  const dates = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [month]);

  /** The shift that applies to an employee on a date, the same way the database picks it. */
  const shiftOn = (employeeId: string, date: string): ShiftRow | null => {
    const rows = assignments
      .filter(
        (a) =>
          a.employee_id === employeeId &&
          a.effective_from <= date &&
          (a.effective_to === null || a.effective_to >= date),
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    const chosen = rows[0];
    if (chosen) return shiftById.get(chosen.shift_id) ?? null;
    return shifts.find((s) => s.is_default) ?? null;
  };

  const unassigned = staff.filter((s) => !assignments.some((a) => a.employee_id === s.id && a.effective_to === null));

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) {
      setPicked([]);
      close();
      router.refresh();
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Shifts" value={shifts.length} foot={shifts.find((s) => s.is_default)?.name ?? 'no default set'} icon="clock" accent="brand" />
        <Kpi label="On a named shift" value={staff.length - unassigned.length} foot={`of ${staff.length} active`} icon="users" accent="leaf" />
        <Kpi label="On the default" value={unassigned.length} foot="no explicit assignment" icon="user" accent={unassigned.length ? 'amber' : 'slate'} />
        <Kpi label="Weekly offs" value={weeklyOffs.map((d) => DOW[d]).join(', ') || 'none'} foot="set under Settings" icon="calendar" accent="slate" />
      </div>

      {shifts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="clock"
            title="No shifts yet"
            body="A shift decides when somebody is late, what counts as a half day and what counts as a full one. Attendance cannot judge a day without one, so create at least one and mark it the default."
            action={
              caps.write ? (
                <button className="btn btn-primary" onClick={() => setOpen({ kind: 'shift' })}>
                  <Icon name="plus" size={16} />
                  Create a shift
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="card mb-5">
            <div className="mb-3.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm">Shifts</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                  Grace is how late somebody can be before it counts. Below the half-day threshold a
                  day is a half day; above the full-day one it is a full day.
                </p>
              </div>
              {caps.write ? (
                <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'shift' })}>
                  <Icon name="plus" size={14} />
                  New shift
                </button>
              ) : null}
            </div>
            <div className="flex flex-col divide-y divide-slate-line2">
              {shifts.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">
                      {s.name}
                      {s.is_default ? <span className="ml-2 badge">default</span> : null}
                    </b>
                    <span className="block text-[11px] text-slate-muted">
                      {hhmm(s.start_time)} to {hhmm(s.end_time)} · {s.grace_minutes} min grace ·
                      half day at {Math.round(s.half_day_minutes / 60)}h · full day at{' '}
                      {Math.round(s.full_day_minutes / 60)}h
                    </span>
                  </div>
                  {caps.write ? (
                    <button className="btn btn-sm" onClick={() => setOpen({ kind: 'shift', shift: s })}>
                      Edit
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm">Roster · {monthLabel(month)}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                  Who is on which shift, day by day. Weekly offs and holidays are marked, so a gap in
                  the grid is a real gap rather than a Sunday.
                </p>
              </div>
              <select
                className="max-w-[170px]"
                value={dept}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDept(e.target.value)}
              >
                <option value="">Every department</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {caps.write ? (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={picked.length === 0}
                  onClick={() => setOpen({ kind: 'assign' })}
                >
                  Assign {picked.length ? `${picked.length} selected` : '— pick people first'}
                </button>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white p-2 text-left text-xs uppercase tracking-wide text-slate-muted">
                      Employee
                    </th>
                    {dates.map((d) => {
                      const dow = new Date(`${d}T00:00:00`).getDay();
                      const off = weeklyOffs.includes(dow) || holidayByDate.has(d);
                      return (
                        <th
                          key={d}
                          title={holidayByDate.get(d) ?? DOW[dow]}
                          className={`p-1 text-center text-[10px] font-semibold ${off ? 'text-slate-faint' : 'text-slate-muted'}`}
                        >
                          {d.slice(8)}
                          <span className="block text-[8px] font-normal">{DOW[dow].slice(0, 1)}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id} className="border-b border-slate-line2 last:border-0">
                      <td className="sticky left-0 z-10 bg-white p-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          {caps.write ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={picked.includes(s.id)}
                              onChange={() => toggle(s.id)}
                            />
                          ) : null}
                          <Avatar name={s.full_name} />
                          <span className="min-w-0">
                            <b className="block truncate text-[12px] font-semibold text-ink">{s.full_name}</b>
                            <span className="block text-[10px] text-slate-muted">{s.employee_code}</span>
                          </span>
                        </label>
                      </td>
                      {dates.map((d) => {
                        const dow = new Date(`${d}T00:00:00`).getDay();
                        const holiday = holidayByDate.get(d);
                        const off = weeklyOffs.includes(dow);
                        const sh = shiftOn(s.id, d);
                        return (
                          <td key={d} className="p-0.5 text-center">
                            <span
                              title={
                                holiday
                                  ? holiday
                                  : off
                                    ? 'Weekly off'
                                    : sh
                                      ? `${sh.name} · ${hhmm(sh.start_time)}–${hhmm(sh.end_time)}`
                                      : 'No shift'
                              }
                              className={`flex h-6 w-6 items-center justify-center rounded text-[9px] font-bold ${
                                holiday
                                  ? 'bg-brand-soft text-brand-dark'
                                  : off
                                    ? 'bg-slate-line2 text-slate-faint'
                                    : sh
                                      ? 'bg-leaf-soft text-leaf-text'
                                      : 'bg-amber-bg text-amber-text'
                              }`}
                            >
                              {holiday ? 'H' : off ? '—' : sh ? initials(sh.name) : '?'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-muted">
              {shifts.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-leaf-soft text-[9px] font-bold text-leaf-text">
                    {initials(s.name)}
                  </span>
                  {s.name}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-line2 text-[9px] font-bold text-slate-faint">—</span>
                weekly off
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-soft text-[9px] font-bold text-brand-dark">H</span>
                holiday
              </span>
            </div>
          </div>

          <div className="card mt-5">
            <h3 className="mb-3 text-sm">Assignments</h3>
            {assignments.length === 0 ? (
              <p className="text-[13px] text-slate-muted">
                Nobody has an explicit assignment — everyone is on the default shift.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {assignments.slice(0, 40).map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">{a.employee_name}</b>
                      <span className="block text-[11px] text-slate-muted">
                        {shiftById.get(a.shift_id)?.name ?? 'Shift'} · from {dateLabel(a.effective_from)}
                        {a.effective_to ? ` to ${dateLabel(a.effective_to)}` : ' · open ended'}
                      </span>
                    </div>
                    {caps.write && !a.effective_to ? (
                      <button className="btn btn-sm" onClick={() => setOpen({ kind: 'end', row: a })}>
                        End it
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ------------------------------------------------------------ modals */}
      {open?.kind === 'assign' ? (
        <Modal title={`Assign ${picked.length} employee(s) to a shift`} onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'shift_id',
                label: 'Shift',
                type: 'select',
                options: shifts.map((s) => ({ value: s.id, label: `${s.name} (${hhmm(s.start_time)}–${hhmm(s.end_time)})` })),
                rules: [V.required('Shift')],
              },
              { name: 'effective_from', label: 'From', type: 'date', rules: [V.required('Start date')], half: true },
              {
                name: 'effective_to',
                label: 'Until (optional)',
                type: 'date',
                half: true,
                hint: 'Leave blank for an open-ended assignment.',
              },
            ]}
            initial={{ effective_from: new Date().toISOString().slice(0, 10) }}
            action={(vals: Values) => assignShift({ ...vals, employee_ids: picked.join(',') })}
            submitLabel="Assign"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Any open assignment these people already have is closed the day before this one
                starts, so no date ever has two shifts.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'end' && open.row ? (
        <Modal title={`End ${open.row.employee_name}'s assignment`} onClose={close}>
          <RecordForm
            fields={[{ name: 'effective_to', label: 'Last day on this shift', type: 'date', rules: [V.required('Date')] }]}
            initial={{ effective_to: new Date().toISOString().slice(0, 10) }}
            action={(vals: Values) => endShiftAssignment({ ...vals, id: open.row!.id })}
            submitLabel="End it"
            onDone={close}
            onCancel={close}
            note={<span>They fall back to the default shift the next day.</span>}
          />
        </Modal>
      ) : null}

      {open?.kind === 'shift' ? (
        <Modal title={open.shift ? 'Edit shift' : 'New shift'} wide onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Name', rules: [V.required('Name')], placeholder: 'General' },
              { name: 'start_time', label: 'Starts', placeholder: '09:30', rules: [V.required('Start')], half: true },
              { name: 'end_time', label: 'Ends', placeholder: '18:30', rules: [V.required('End')], half: true },
              {
                name: 'grace_minutes',
                label: 'Grace, minutes',
                type: 'number',
                rules: [V.nonNegative('Grace')],
                hint: 'How late somebody can be before the day is marked late.',
                half: true,
              },
              {
                name: 'half_day_minutes',
                label: 'Half day at, minutes worked',
                type: 'number',
                rules: [V.nonNegative('Half day')],
                half: true,
              },
              {
                name: 'full_day_minutes',
                label: 'Full day at, minutes worked',
                type: 'number',
                rules: [V.nonNegative('Full day')],
                half: true,
              },
              {
                name: 'is_default',
                label: 'Default shift — used for anybody without an assignment',
                type: 'switch',
              },
            ]}
            initial={{
              name: open.shift?.name ?? '',
              start_time: hhmm(open.shift?.start_time ?? '09:30'),
              end_time: hhmm(open.shift?.end_time ?? '18:30'),
              grace_minutes: String(open.shift?.grace_minutes ?? 15),
              half_day_minutes: String(open.shift?.half_day_minutes ?? 240),
              full_day_minutes: String(open.shift?.full_day_minutes ?? 480),
              is_default: open.shift?.is_default ?? shifts.length === 0,
            }}
            action={(vals: Values) => saveShift({ ...vals, id: open.shift?.id ?? '' })}
            submitLabel="Save shift"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'S';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
