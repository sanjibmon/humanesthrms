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
import {
  saveAttendanceDay, bulkMarkDay, addPunch, saveAttendanceDevice,
  approveOvertime, pushOvertimeToPayroll,
} from '@/app/actions/attendance';
import { decideApproval } from '@/app/actions/approvals';

export type DayRow = {
  employee_id: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number | null;
  status: string;
  late_minutes: number | null;
  overtime_minutes: number | null;
  overtime_approved_minutes: number | null;
  source: string | null;
  is_regularized: boolean;
  locked: boolean;
};

export type StaffRow = {
  id: string;
  full_name: string;
  employee_code: string;
  department: string | null;
  location: string | null;
};

export type RegRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  request_type: string;
  requested_in: string | null;
  requested_out: string | null;
  reason: string;
  status: string;
  approval_request_id: string | null;
  created_at: string;
};

export type EventRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  event_time: string;
  event_type: string;
  source: string;
  inside_geofence: boolean | null;
  distance_m: number | null;
  is_mock_location: boolean | null;
  flags: string[] | null;
};

export type DeviceRow = {
  id: string;
  name: string;
  device_type: string;
  vendor: string | null;
  serial_no: string | null;
  status: string;
  last_sync_at: string | null;
  location_id: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  present: 'Present', late: 'Late', half_day: 'Half day', absent: 'Absent',
  wfh: 'Work from home', leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty',
};

const STATUS_CLASS: Record<string, string> = {
  present: 'bg-leaf-soft text-leaf-text',
  on_duty: 'bg-leaf-soft text-leaf-text',
  wfh: 'bg-brand-soft text-brand-dark',
  late: 'bg-amber-bg text-amber-text',
  half_day: 'bg-amber-bg text-amber-text',
  absent: 'bg-red-50 text-red-700',
  leave: 'bg-brand-soft text-brand-dark',
  holiday: 'bg-slate-line2 text-slate-muted',
  weekly_off: 'bg-slate-line2 text-slate-muted',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));

const TABS = ['Register', 'Overtime', 'Regularisations', 'Punch log', 'Devices'] as const;

export function AttendanceConsole({
  month,
  days,
  staff,
  regs,
  events,
  devices,
  locations,
  holidays,
  caps,
}: {
  month: string;
  days: DayRow[];
  staff: StaffRow[];
  regs: RegRow[];
  events: EventRow[];
  devices: DeviceRow[];
  locations: { value: string; label: string }[];
  holidays: { holiday_date: string; name: string }[];
  caps: { write: boolean; approve: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Register');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ kind: string; day?: DayRow; emp?: StaffRow; date?: string; device?: DeviceRow; reg?: RegRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const departments = useMemo(
    () => [...new Set(staff.map((s) => s.department).filter(Boolean) as string[])].sort(),
    [staff],
  );

  const dayByKey = useMemo(() => {
    const m = new Map<string, DayRow>();
    for (const d of days) m.set(`${d.employee_id}|${d.work_date}`, d);
    return m;
  }, [days]);

  const dates = useMemo(() => datesOf(month), [month]);
  const holidayByDate = useMemo(
    () => new Map(holidays.map((h) => [h.holiday_date, h.name])),
    [holidays],
  );

  const visibleStaff = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return staff.filter((s) => {
      if (dept && s.department !== dept) return false;
      if (needle && !`${s.full_name} ${s.employee_code}`.toLowerCase().includes(needle)) return false;
      if (status) {
        const has = dates.some((d) => dayByKey.get(`${s.id}|${d}`)?.status === status);
        if (!has) return false;
      }
      return true;
    });
  }, [staff, dept, q, status, dates, dayByKey]);

  /* Counts for today — the number people actually ask for in the morning. */
  const today = new Date().toISOString().slice(0, 10);
  const todays = useMemo(() => days.filter((d) => d.work_date === today), [days, today]);
  const count = (s: string) => todays.filter((d) => d.status === s).length;
  const presentToday = count('present') + count('late') + count('wfh') + count('on_duty');
  const pendingRegs = regs.filter((r) => r.status === 'pending');

  /* Overtime. Recorded is what the clock says; approved is what somebody signed
     off. Payroll only ever prices the second, so the gap between them is the
     thing this tab exists to close. */
  const otRows = useMemo(() => {
    const m = new Map<string, { recorded: number; approved: number; days: number; pending: number }>();
    for (const d of days) {
      const rec = Number(d.overtime_minutes ?? 0);
      const app = Number(d.overtime_approved_minutes ?? 0);
      if (!rec && !app) continue;
      const cur = m.get(d.employee_id) ?? { recorded: 0, approved: 0, days: 0, pending: 0 };
      cur.recorded += rec;
      cur.approved += app;
      cur.days += 1;
      if (rec > app) cur.pending += 1;
      m.set(d.employee_id, cur);
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v, name: staffById.get(id)?.full_name ?? 'Employee', code: staffById.get(id)?.employee_code ?? '—' }))
      .sort((a, b) => b.recorded - a.recorded);
  }, [days, staffById]);

  const otPendingDays = otRows.reduce((a, r) => a + r.pending, 0);
  const otApproved = otRows.reduce((a, r) => a + r.approved, 0);
  const otRecorded = otRows.reduce((a, r) => a + r.recorded, 0);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) {
      close();
      router.refresh();
    }
  }

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="In today" value={presentToday} foot={`of ${staff.length} active`} icon="users" accent="leaf" />
        <Kpi label="On leave today" value={count('leave')} foot="approved applications" icon="calendar" accent="brand" />
        <Kpi label="Absent today" value={count('absent')} foot="no punch, no leave" icon="alert" accent="amber" />
        <Kpi label="Regularisations waiting" value={pendingRegs.length} foot="corrections to decide" icon="clipboard" accent="slate" />
      </div>

      <div className="tabbar mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Regularisations' && pendingRegs.length ? (
              <span className="ml-1.5 rounded-full bg-amber-bg px-1.5 text-[11px] font-semibold text-amber-text">
                {pendingRegs.length}
              </span>
            ) : null}
            {t === 'Overtime' && otPendingDays ? (
              <span className="ml-1.5 rounded-full bg-amber-bg px-1.5 text-[11px] font-semibold text-amber-text">
                {otPendingDays}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- register */}
      {tab === 'Register' ? (
        <div className="card">
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <input
              className="max-w-[200px]"
              placeholder="Name or code…"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            />
            <select className="max-w-[180px]" value={dept} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDept(e.target.value)}>
              <option value="">Every department</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select className="max-w-[180px]" value={status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span className="text-xs text-slate-muted">
              {visibleStaff.length} of {staff.length}
            </span>
            {caps.write ? (
              <div className="ml-auto flex gap-2">
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'punch' })}>
                  <Icon name="clock" size={14} />
                  Add punch
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'bulk' })}>
                  Mark a day
                </button>
              </div>
            ) : null}
          </div>

          {staff.length === 0 ? (
            <EmptyState
              icon="users"
              title="No active employees"
              body="Attendance follows the employee list. Add people first and their register appears here."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white p-2 text-left text-xs uppercase tracking-wide text-slate-muted">
                        Employee
                      </th>
                      {dates.map((d) => {
                        const dow = new Date(`${d}T00:00:00`).getDay();
                        const holiday = holidayByDate.get(d);
                        return (
                          <th
                            key={d}
                            title={holiday ?? undefined}
                            className={`p-1 text-center text-[10px] font-semibold ${
                              holiday ? 'text-brand-dark' : dow === 0 ? 'text-slate-faint' : 'text-slate-muted'
                            }`}
                          >
                            {d.slice(8)}
                          </th>
                        );
                      })}
                      <th className="p-2 text-right text-xs uppercase tracking-wide text-slate-muted">P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStaff.map((s) => {
                      let present = 0;
                      const cells = dates.map((d) => {
                        const row = dayByKey.get(`${s.id}|${d}`);
                        if (row && ['present', 'late', 'wfh', 'on_duty'].includes(row.status)) present += 1;
                        if (row?.status === 'half_day') present += 0.5;
                        return { d, row };
                      });
                      return (
                        <tr key={s.id} className="border-b border-slate-line2 last:border-0">
                          <td className="sticky left-0 z-10 bg-white p-2">
                            <div className="flex items-center gap-2">
                              <Avatar name={s.full_name} />
                              <span className="min-w-0">
                                <b className="block truncate text-[12px] font-semibold text-ink">{s.full_name}</b>
                                <span className="block text-[10px] text-slate-muted">{s.employee_code}</span>
                              </span>
                            </div>
                          </td>
                          {cells.map(({ d, row }) => (
                            <td key={d} className="p-0.5 text-center">
                              <button
                                className={`h-6 w-6 rounded text-[10px] font-bold transition ${cellClass(row, holidayByDate.has(d), d)}`}
                                title={cellTitle(s.full_name, d, row, holidayByDate.get(d))}
                                disabled={!caps.write}
                                onClick={() => setOpen({ kind: 'day', emp: s, date: d, day: row })}
                              >
                                {cellMark(row, holidayByDate.has(d), d)}
                              </button>
                            </td>
                          ))}
                          <td className="p-2 text-right font-semibold tabular-nums text-ink">
                            {present % 1 ? present.toFixed(1) : present}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-muted">
                {[
                  ['P', 'present'], ['L', 'late'], ['½', 'half_day'], ['A', 'absent'],
                  ['W', 'wfh'], ['V', 'leave'], ['H', 'holiday'], ['—', 'weekly_off'],
                ].map(([mark, st]) => (
                  <span key={st} className="flex items-center gap-1.5">
                    <span className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${STATUS_CLASS[st] ?? 'bg-slate-line2 text-slate-muted'}`}>
                      {mark}
                    </span>
                    {STATUS_LABEL[st]}
                  </span>
                ))}
                <span className="ml-auto">
                  {caps.write ? 'Click any day to correct it. A day inside a locked pay run is refused.' : 'Read only.'}
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* --------------------------------------------------------- overtime */}
      {tab === 'Overtime' ? (
        <div className="card">
          <div className="mb-3.5 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Overtime · {month}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                Recorded is what the day worked out to; approved is what somebody signed off.
                Payroll prices only the approved hours, so nothing reaches a payslip because a
                reader was left running. Approving skips any day inside a locked pay run.
              </p>
            </div>
            <div className="flex gap-2">
              {caps.approve && otPendingDays ? (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => run(() => approveOvertime({ period_month: month }))}
                >
                  <Icon name="checkcircle" size={14} />
                  Approve {otPendingDays} day{otPendingDays === 1 ? '' : 's'}
                </button>
              ) : null}
              {otApproved ? (
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => run(() => pushOvertimeToPayroll({ period_month: month }))}
                >
                  Send to payroll
                </button>
              ) : null}
            </div>
          </div>

          {otRows.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No overtime this month"
              body="Overtime appears here once a day records more than its shift's full-day minutes, or once somebody enters it by hand on a day."
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-[12px] text-slate-muted">
                <span>
                  Recorded <b className="text-ink">{mins(otRecorded)}</b>
                </span>
                <span>
                  Approved <b className="text-leaf-text">{mins(otApproved)}</b>
                </span>
                {otRecorded > otApproved ? (
                  <span>
                    Waiting <b className="text-amber-text">{mins(otRecorded - otApproved)}</b>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col divide-y divide-slate-line2">
                {otRows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Avatar name={r.name} />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">{r.name}</b>
                      <span className="block text-[11px] text-slate-muted">
                        {r.code} · across {r.days} day{r.days === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-muted">
                      recorded <b className="text-ink">{mins(r.recorded)}</b>
                    </span>
                    <span className="text-[12px] text-slate-muted">
                      approved <b className={r.approved ? 'text-leaf-text' : 'text-slate-faint'}>{mins(r.approved)}</b>
                    </span>
                    {r.recorded > r.approved && caps.approve ? (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() => run(() => approveOvertime({ period_month: month, employee_id: r.id }))}
                      >
                        Approve
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-muted">
                Sending to payroll writes one adjustment per employee for the month and replaces any
                earlier one, so approving a few more hours and sending again corrects the figure
                rather than doubling it. Recompute the run afterwards to price them.
              </p>
            </>
          )}
        </div>
      ) : null}

      {/* -------------------------------------------------- regularisations */}
      {tab === 'Regularisations' ? (
        <div className="card">
          <h3 className="mb-1 text-sm">Correction requests</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            A missed punch is corrected by the employee asking, not by HR editing quietly. Approving
            one writes the day and marks it regularised, so a later device sync cannot undo it.
          </p>
          {regs.length === 0 ? (
            <p className="text-[13px] text-slate-muted">Nothing requested.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {regs.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">
                      {r.employee_name} · {dateLabel(r.work_date)}
                    </b>
                    <span className="block text-[11px] text-slate-muted">
                      {r.request_type.replace(/_/g, ' ')}
                      {r.requested_in ? ` · in ${timeOf(r.requested_in)}` : ''}
                      {r.requested_out ? ` · out ${timeOf(r.requested_out)}` : ''}
                    </span>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-body">{r.reason}</p>
                  </div>
                  <span className={`badge ${r.status === 'pending' ? 'bg-amber-bg text-amber-text' : r.status === 'approved' ? 'bg-leaf-soft text-leaf-text' : 'bg-slate-line2 text-slate-muted'}`}>
                    {r.status}
                  </span>
                  {r.status === 'pending' && caps.approve && r.approval_request_id ? (
                    <div className="flex gap-2">
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => setOpen({ kind: 'reject', reg: r })}
                      >
                        Reject
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() =>
                          run(() => decideApproval({ id: r.approval_request_id as string, decision: 'approve', comment: '' }))
                        }
                      >
                        Approve
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* --------------------------------------------------------- punch log */}
      {tab === 'Punch log' ? (
        <div className="card">
          <h3 className="mb-1 text-sm">Punches</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            Append-only. The geofence result is computed on the server from the employee&apos;s work
            location, so a phone cannot claim it was inside the radius when it was not.
          </p>
          {events.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No punches recorded"
              body="Punches arrive from the mobile app, a biometric device or an HR entry. Each one recalculates that employee's day."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                    <th className="p-2.5 font-semibold">When</th>
                    <th className="p-2.5 font-semibold">Employee</th>
                    <th className="p-2.5 font-semibold">Direction</th>
                    <th className="p-2.5 font-semibold">Source</th>
                    <th className="p-2.5 font-semibold">Location check</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-slate-line2 last:border-0">
                      <td className="p-2.5 whitespace-nowrap">
                        {dateLabel(e.event_time)} <span className="text-slate-muted">{timeOf(e.event_time)}</span>
                      </td>
                      <td className="p-2.5 font-semibold text-ink">{e.employee_name}</td>
                      <td className="p-2.5">
                        <span className={`badge ${e.event_type === 'in' ? 'bg-leaf-soft text-leaf-text' : 'bg-slate-line2 text-slate-muted'}`}>
                          {e.event_type}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-muted">{e.source.replace(/_/g, ' ')}</td>
                      <td className="p-2.5">
                        {e.is_mock_location ? (
                          <span className="badge bg-red-50 text-red-700">mock location</span>
                        ) : e.inside_geofence === null ? (
                          <span className="text-slate-faint">not checked</span>
                        ) : e.inside_geofence ? (
                          <span className="badge bg-leaf-soft text-leaf-text">inside</span>
                        ) : (
                          <span className="badge bg-amber-bg text-amber-text">
                            {e.distance_m ? `${Math.round(Number(e.distance_m))} m away` : 'outside'}
                          </span>
                        )}
                        {e.flags?.length ? (
                          <span className="ml-1.5 text-[11px] text-amber-text">{e.flags.join(', ')}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* ----------------------------------------------------------- devices */}
      {tab === 'Devices' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Attendance devices</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                Registered readers. A device pushes punches in; nothing here can change a day
                directly, which is what keeps the punch log trustworthy.
              </p>
            </div>
            {caps.write ? (
              <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'device' })}>
                <Icon name="plus" size={14} />
                Add device
              </button>
            ) : null}
          </div>
          {devices.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
              None registered. The mobile app works without one.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {devices.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">{d.name}</b>
                    <span className="block text-[11px] text-slate-muted">
                      {d.device_type}
                      {d.vendor ? ` · ${d.vendor}` : ''}
                      {d.serial_no ? ` · ${d.serial_no}` : ''}
                      {d.last_sync_at ? ` · last sync ${dateLabel(d.last_sync_at)}` : ' · never synced'}
                    </span>
                  </div>
                  <span className={`badge ${d.status === 'online' ? 'bg-leaf-soft text-leaf-text' : d.status === 'offline' ? 'bg-red-50 text-red-700' : 'bg-slate-line2 text-slate-muted'}`}>
                    {d.status}
                  </span>
                  {caps.write ? (
                    <button className="btn btn-sm" onClick={() => setOpen({ kind: 'device', device: d })}>
                      Edit
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      {open?.kind === 'day' && open.emp && open.date ? (
        <Modal
          title={`${open.emp.full_name} · ${dateLabel(open.date)}`}
          sub={open.day?.locked ? 'Locked by a pay run — read only' : 'Correcting a day marks it regularised'}
          onClose={close}
        >
          {open.day?.locked ? (
            <p className="text-[13px] leading-relaxed text-slate-body">
              This day sits inside a locked pay run, so it cannot be changed. A correction belongs in
              the next month as an adjustment.
            </p>
          ) : (
            <RecordForm
              fields={[
                { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, rules: [V.required('Status')] },
                { name: 'first_in', label: 'In', placeholder: '09:30', hint: '24-hour, in the organisation’s timezone. Leave blank for a day with no hours.', half: true },
                { name: 'last_out', label: 'Out', placeholder: '18:30', half: true },
                { name: 'overtime_minutes', label: 'Overtime, minutes', type: 'number', rules: [V.nonNegative('Overtime')], half: true },
              ]}
              initial={{
                status: open.day?.status ?? 'present',
                first_in: hhmm(open.day?.first_in),
                last_out: hhmm(open.day?.last_out),
                overtime_minutes: String(open.day?.overtime_minutes ?? 0),
              }}
              action={(vals: Values) =>
                saveAttendanceDay({ ...vals, employee_id: open.emp!.id, work_date: open.date! })
              }
              submitLabel="Save day"
              onDone={close}
              onCancel={close}
            />
          )}
        </Modal>
      ) : null}

      {open?.kind === 'bulk' ? (
        <Modal
          title="Mark a whole day"
          sub="Only for employees who have no record on that date"
          onClose={close}
        >
          <RecordForm
            fields={[
              { name: 'work_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
              { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, rules: [V.required('Status')], half: true },
            ]}
            initial={{ work_date: today, status: 'absent' }}
            action={bulkMarkDay}
            submitLabel="Mark the day"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Anyone who already has a record for that date keeps it — this fills gaps, it does not
                overwrite. Use it at month end so payroll does not treat a missing day as attendance.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'punch' ? (
        <Modal title="Record a punch" sub="For a reader that was down, or somebody at a client site" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'employee_id',
                label: 'Employee',
                type: 'select',
                options: staff.map((s) => ({ value: s.id, label: `${s.full_name} (${s.employee_code})` })),
                rules: [V.required('Employee')],
              },
              { name: 'work_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
              { name: 'event_time', label: 'Time', placeholder: '09:30', rules: [V.required('Time')], half: true },
              {
                name: 'event_type',
                label: 'Direction',
                type: 'select',
                options: [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }],
                rules: [V.required('Direction')],
              },
            ]}
            initial={{ work_date: today, event_type: 'in' }}
            action={addPunch}
            submitLabel="Record punch"
            onDone={close}
            onCancel={close}
            note={
              <span>
                It goes in as a punch, not as a day, so the day is derived from it the same way a real
                punch would be — and the entry carries your name.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'device' ? (
        <Modal title={open.device ? 'Edit device' : 'Add a device'} onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Name', rules: [V.required('Name')], placeholder: 'Reception reader' },
              {
                name: 'device_type', label: 'Type', type: 'select', half: true,
                options: [
                  { value: 'biometric', label: 'Fingerprint' },
                  { value: 'face', label: 'Face' },
                  { value: 'rfid', label: 'RFID card' },
                  { value: 'kiosk', label: 'Kiosk' },
                ],
              },
              {
                name: 'vendor', label: 'Vendor', type: 'select', half: true,
                options: [
                  { value: '', label: 'Not set' },
                  { value: 'essl', label: 'eSSL' },
                  { value: 'matrix', label: 'Matrix' },
                  { value: 'zkteco', label: 'ZKTeco' },
                  { value: 'realtime', label: 'Realtime' },
                  { value: 'other', label: 'Other' },
                ],
              },
              { name: 'serial_no', label: 'Serial number', half: true },
              {
                name: 'status', label: 'Status', type: 'select', half: true,
                options: [
                  { value: 'unknown', label: 'Unknown' },
                  { value: 'online', label: 'Online' },
                  { value: 'offline', label: 'Offline' },
                ],
              },
              {
                name: 'location_id', label: 'Location', type: 'select',
                options: [{ value: '', label: 'Not tied to a location' }, ...locations],
              },
            ]}
            initial={{
              code: '',
              name: open.device?.name ?? '',
              device_type: open.device?.device_type ?? 'biometric',
              vendor: open.device?.vendor ?? '',
              serial_no: open.device?.serial_no ?? '',
              status: open.device?.status ?? 'unknown',
              location_id: open.device?.location_id ?? '',
            }}
            action={(vals: Values) => saveAttendanceDevice({ ...vals, id: open.device?.id ?? '' })}
            submitLabel="Save device"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'reject' && open.reg ? (
        <Modal title="Reject this correction" sub="The employee sees your reason" onClose={close}>
          <RecordForm
            fields={[{ name: 'comment', label: 'Why?', type: 'textarea', rules: [V.required('Reason')] }]}
            action={(vals: Values) =>
              decideApproval({
                id: open.reg!.approval_request_id as string,
                decision: 'reject',
                comment: String(vals.comment ?? ''),
              })
            }
            submitLabel="Reject"
            onDone={() => {
              close();
              router.refresh();
            }}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------- utils */

function datesOf(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const mins = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
};

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

const hhmm = (iso: string | null | undefined) => (iso ? timeOf(iso) : '');

function cellMark(row: DayRow | undefined, isHoliday: boolean, date: string): string {
  if (row) {
    return { present: 'P', late: 'L', half_day: '½', absent: 'A', wfh: 'W', leave: 'V', holiday: 'H', weekly_off: '—', on_duty: 'D' }[row.status] ?? '?';
  }
  if (isHoliday) return 'H';
  if (new Date(`${date}T00:00:00`).getDay() === 0) return '—';
  return '';
}

function cellClass(row: DayRow | undefined, isHoliday: boolean, date: string): string {
  const base = 'hover:ring-2 hover:ring-brand disabled:hover:ring-0 ';
  if (row) return base + (STATUS_CLASS[row.status] ?? 'bg-slate-line2 text-slate-muted');
  if (isHoliday || new Date(`${date}T00:00:00`).getDay() === 0) return base + 'bg-slate-line2 text-slate-faint';
  return base + 'bg-slate-surface text-slate-faint';
}

function cellTitle(name: string, date: string, row: DayRow | undefined, holiday?: string): string {
  const head = `${name} · ${date}`;
  if (!row) return `${head} · ${holiday ? holiday : 'no record'}`;
  const parts = [STATUS_LABEL[row.status] ?? row.status];
  if (row.first_in) parts.push(`in ${timeOf(row.first_in)}`);
  if (row.last_out) parts.push(`out ${timeOf(row.last_out)}`);
  if (row.late_minutes) parts.push(`${row.late_minutes} min late`);
  if (row.is_regularized) parts.push('regularised');
  if (row.locked) parts.push('locked by payroll');
  return `${head} · ${parts.join(' · ')}`;
}
