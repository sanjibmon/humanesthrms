'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { requestRegularization } from '@/app/actions/ess';

export type DayRow = {
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number | null;
  status: string;
  late_minutes: number | null;
  overtime_minutes: number | null;
  is_regularized: boolean;
  locked: boolean;
};

export type RegRow = {
  id: string;
  work_date: string;
  request_type: string;
  reason: string;
  status: string;
  created_at: string;
};

const STATUS_CLASS: Record<string, string> = {
  present: 'bg-leaf-soft text-leaf-text',
  leave: 'bg-brand-soft text-brand-dark',
  absent: 'bg-red-50 text-red-700',
  weekly_off: 'bg-slate-line2 text-slate-muted',
  holiday: 'bg-slate-line2 text-slate-muted',
  half_day: 'bg-amber-bg text-amber-text',
  pending: 'bg-amber-bg text-amber-text',
  approved: 'bg-leaf-soft text-leaf-text',
  rejected: 'bg-red-50 text-red-700',
};

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

const hours = (m: number | null) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');

export function AttendanceConsole({
  days,
  regularizations,
  month,
  monthStart,
  canRequest,
}: {
  days: DayRow[];
  regularizations: RegRow[];
  month: string;
  /** First day of the month the counters describe, as yyyy-mm-dd. */
  monthStart: string;
  canRequest: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  /* The table deliberately carries the tail of last month so a correction near
     month-end stays reachable, but the counters must describe one month or they
     mean nothing. */
  const thisMonth = days.filter((d) => d.work_date >= monthStart);
  const present = thisMonth.filter((d) => d.status === 'present' || d.status === 'half_day').length;
  const absent = thisMonth.filter((d) => d.status === 'absent').length;
  const onLeave = thisMonth.filter((d) => d.status === 'leave').length;
  const lateTotal = thisMonth.reduce((a, d) => a + (d.late_minutes ?? 0), 0);

  const fields = (date: string): FieldDef[] => [
    { name: 'work_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
    {
      name: 'request_type',
      label: 'What went wrong',
      type: 'select',
      options: [
        { value: 'missed_in', label: 'Missed the check-in' },
        { value: 'missed_out', label: 'Missed the check-out' },
        { value: 'wrong_punch', label: 'Wrong punch recorded' },
        { value: 'wfh', label: 'Worked from home' },
        { value: 'on_duty', label: 'On duty elsewhere' },
      ],
      rules: [V.required('A type')],
      half: true,
    },
    { name: 'in_time', label: 'Actual in time', placeholder: '09:30', hint: '24-hour clock.', half: true },
    { name: 'out_time', label: 'Actual out time', placeholder: '18:45', half: true },
    {
      name: 'reason',
      label: 'Reason',
      type: 'textarea',
      rules: [V.required('A reason'), V.minLen(3, 'The reason')],
      hint: 'Your manager decides on this, so give them something to go on.',
    },
  ];

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Present" value={present} foot={`in ${month}`} />
        <Stat label="On leave" value={onLeave} foot="approved days" />
        <Stat label="Absent" value={absent} foot="unaccounted" />
        <Stat label="Late" value={hours(lateTotal)} foot="total this month" />
      </div>

      <div className="card mb-5">
        <div className="mb-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">My attendance — {month}</h3>
            <p className="mt-0.5 text-xs text-slate-muted">
              A locked day has been through payroll and can no longer be regularised.
            </p>
          </div>
          {canRequest ? (
            <button className="btn btn-sm" onClick={() => setOpen(new Date().toISOString().slice(0, 10))}>
              <Icon name="clock" size={14} />
              Regularise
            </button>
          ) : null}
        </div>

        {days.length === 0 ? (
          <EmptyState
            icon="clock"
            title="Nothing recorded this month"
            body="Days appear here as they are punched, imported from a device, or marked by an approved leave."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-2.5 font-semibold">Date</th>
                  <th className="p-2.5 font-semibold">In</th>
                  <th className="p-2.5 font-semibold">Out</th>
                  <th className="p-2.5 font-semibold">Worked</th>
                  <th className="p-2.5 font-semibold">Status</th>
                  <th className="p-2.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.work_date} className="border-b border-slate-line2 last:border-0">
                    <td className="p-2.5">
                      {dateLabel(d.work_date)}
                      {d.is_regularized ? (
                        <span className="ml-1.5 text-[11px] text-slate-muted">regularised</span>
                      ) : null}
                    </td>
                    <td className="p-2.5 font-mono text-xs">{clock(d.first_in)}</td>
                    <td className="p-2.5 font-mono text-xs">{clock(d.last_out)}</td>
                    <td className="p-2.5 text-slate-muted">{hours(d.worked_minutes)}</td>
                    <td className="p-2.5">
                      <span className={`badge ${STATUS_CLASS[d.status] ?? ''}`}>
                        {d.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-2.5 text-right">
                      {canRequest && !d.locked && ['absent', 'half_day', 'present'].includes(d.status) ? (
                        <button className="btn btn-sm" onClick={() => setOpen(d.work_date)}>
                          Fix
                        </button>
                      ) : d.locked ? (
                        <span className="text-[11px] text-slate-faint">locked</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm">My regularisation requests</h3>
        {regularizations.length === 0 ? (
          <p className="text-[13px] text-slate-muted">None raised. The window is the last 31 days.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {regularizations.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-ink">
                    {r.request_type.replace(/_/g, ' ')} · {dateLabel(r.work_date)}
                  </b>
                  <span className="block truncate text-[11px] text-slate-muted">{r.reason}</span>
                </div>
                <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {open ? (
        <Modal
          title="Regularise a day"
          sub="Goes to your reporting manager, or to HR when you have none"
          onClose={() => setOpen(null)}
        >
          <RecordForm
            fields={fields(open)}
            initial={{ work_date: open, request_type: 'missed_in' }}
            action={requestRegularization}
            submitLabel="Send request"
            onDone={() => setOpen(null)}
            onCancel={() => setOpen(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}

function Stat({ label, value, foot }: { label: string; value: React.ReactNode; foot: string }) {
  return (
    <div className="card">
      <span className="lbl">{label}</span>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-muted">{foot}</p>
    </div>
  );
}
