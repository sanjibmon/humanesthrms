'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Kpi, EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  adjustLeaveBalance, creditLeaveYear, cancelLeaveFor, saveHoliday, deleteHoliday, runLeaveAccrual,
} from '@/app/actions/leave';
import { decideApproval } from '@/app/actions/approvals';

export type TypeRow = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  days_per_year: number | null;
  is_active: boolean;
};

export type RequestRow = {
  id: string;
  request_no: string | null;
  employee_id: string;
  employee_name: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  half_day: string;
  days: number;
  reason: string | null;
  status: string;
  balance_before: number | null;
  balance_after: number | null;
  approval_request_id: string | null;
  applied_at: string;
};

export type BalanceRow = {
  employee_id: string;
  leave_type_id: string;
  balance: number;
  credited: number;
  debited: number;
};

export type LedgerRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type_id: string;
  entry_date: string;
  delta: number;
  reason: string;
  note: string | null;
};

export type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  is_optional: boolean;
  location_id: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-amber-bg text-amber-text',
  approved: 'bg-leaf-soft text-leaf-text',
  rejected: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-line2 text-slate-muted',
};

const REASON_OPTIONS = [
  { value: 'adjustment', label: 'Adjustment — a correction' },
  { value: 'opening', label: 'Opening balance' },
  { value: 'accrual', label: 'Accrual or annual credit' },
  { value: 'carry_forward', label: 'Carry forward from last year' },
  { value: 'encashment', label: 'Encashment' },
  { value: 'lapse', label: 'Lapse' },
];

const TABS = ['Requests', 'Who is off', 'Balances', 'Holidays'] as const;

export function LeaveConsole({
  types,
  requests,
  balances,
  ledger,
  staff,
  holidays,
  locations,
  year,
  caps,
}: {
  types: TypeRow[];
  requests: RequestRow[];
  balances: BalanceRow[];
  ledger: LedgerRow[];
  staff: { id: string; full_name: string; employee_code: string; department: string | null }[];
  holidays: HolidayRow[];
  locations: { value: string; label: string }[];
  year: number;
  caps: { approve: boolean; config: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Requests');
  const [filter, setFilter] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ kind: string; req?: RequestRow; holiday?: HolidayRow; employee?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const typeName = (id: string) => typeById.get(id)?.name ?? 'Leave';

  const pending = requests.filter((r) => r.status === 'pending');
  const today = new Date().toISOString().slice(0, 10);
  const offToday = requests.filter((r) => r.status === 'approved' && r.from_date <= today && r.to_date >= today);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter && r.status !== filter) return false;
      if (typeFilter && r.leave_type_id !== typeFilter) return false;
      if (needle && !`${r.employee_name} ${r.request_no ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [requests, filter, typeFilter, q]);

  /* Balance lookup: employee → type → figure. */
  const balByEmp = useMemo(() => {
    const m = new Map<string, Map<string, BalanceRow>>();
    for (const b of balances) {
      if (!m.has(b.employee_id)) m.set(b.employee_id, new Map());
      m.get(b.employee_id)!.set(b.leave_type_id, b);
    }
    return m;
  }, [balances]);

  const visibleStaff = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? staff.filter((s) => `${s.full_name} ${s.employee_code}`.toLowerCase().includes(needle))
      : staff;
  }, [staff, q]);

  const daysTakenThisYear = useMemo(
    () => requests.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.days), 0),
    [requests],
  );

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
        <Kpi label="Waiting on a decision" value={pending.length} foot="applications" icon="inbox" accent="amber" />
        <Kpi label="Off today" value={offToday.length} foot={`of ${staff.length} active`} icon="calendar" accent="brand" />
        <Kpi label="Days taken" value={daysTakenThisYear % 1 ? daysTakenThisYear.toFixed(1) : daysTakenThisYear} foot={`approved in ${year}`} icon="chart" accent="slate" />
        <Kpi label="Leave types" value={types.filter((t) => t.is_active).length} foot="configured in Settings" icon="file" accent="leaf" />
      </div>

      <div className="tabbar mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Requests' && pending.length ? (
              <span className="ml-1.5 rounded-full bg-amber-bg px-1.5 text-[11px] font-semibold text-amber-text">
                {pending.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- requests */}
      {tab === 'Requests' ? (
        <div className="card">
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <input
              className="max-w-[200px]"
              type="search"
              placeholder="Name or number…"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            />
            <select
              className="max-w-[160px]"
              value={filter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            >
              <option value="">Every status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="max-w-[180px]"
              value={typeFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTypeFilter(e.target.value)}
            >
              <option value="">Every type</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span className="text-xs text-slate-muted">{shown.length} shown</span>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={filter === 'pending' ? 'Nothing waiting' : 'No applications match'}
              body="Applications arrive from the employee portal. Balances are checked, overlaps refused and the document threshold enforced before one can even be submitted."
            />
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {shown.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                  <Avatar name={r.employee_name} />
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">
                      {r.employee_name}
                      <span className="ml-2 font-normal text-slate-muted">{typeName(r.leave_type_id)}</span>
                    </b>
                    <span className="block text-[11px] text-slate-muted">
                      {dateLabel(r.from_date)}
                      {r.from_date !== r.to_date ? ` – ${dateLabel(r.to_date)}` : ''} · {r.days} day
                      {Number(r.days) === 1 ? '' : 's'}
                      {r.half_day && r.half_day !== 'none' ? ` · ${r.half_day.replace(/_/g, ' ')}` : ''}
                      {r.request_no ? ` · ${r.request_no}` : ''}
                      {r.balance_after !== null ? ` · balance after ${r.balance_after}` : ''}
                    </span>
                    {r.reason ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-body">{r.reason}</p>
                    ) : null}
                  </div>
                  <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
                  <div className="flex gap-2">
                    {r.status === 'pending' && caps.approve && r.approval_request_id ? (
                      <>
                        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setOpen({ kind: 'reject', req: r })}>
                          Reject
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy}
                          onClick={() => run(() => decideApproval({ id: r.approval_request_id as string, decision: 'approve', comment: '' }))}
                        >
                          Approve
                        </button>
                      </>
                    ) : null}
                    {r.status === 'approved' && caps.approve && r.from_date > today ? (
                      <button className="btn btn-sm" disabled={busy} onClick={() => setOpen({ kind: 'cancel', req: r })}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* -------------------------------------------------------- who is off */}
      {tab === 'Who is off' ? (
        <div className="card">
          <h3 className="mb-1 text-sm">Approved leave from today</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            What a manager needs before promising a deadline. Days here are already debited from the
            ledger and marked on the attendance register.
          </p>
          {(() => {
            const upcoming = requests
              .filter((r) => r.status === 'approved' && r.to_date >= today)
              .sort((a, b) => a.from_date.localeCompare(b.from_date));
            return upcoming.length === 0 ? (
              <p className="text-[13px] text-slate-muted">Nobody is off, today or ahead.</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {upcoming.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Avatar name={r.employee_name} />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">{r.employee_name}</b>
                      <span className="block text-[11px] text-slate-muted">
                        {typeName(r.leave_type_id)} · {r.days} day{Number(r.days) === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-body">
                      {dateLabel(r.from_date)}
                      {r.from_date !== r.to_date ? ` – ${dateLabel(r.to_date)}` : ''}
                    </span>
                    {r.from_date <= today ? (
                      <span className="badge bg-brand-soft text-brand-dark">off now</span>
                    ) : (
                      <span className="badge">{daysUntil(r.from_date)}</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* --------------------------------------------------------- balances */}
      {tab === 'Balances' ? (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm">Balances for {year}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                  Every figure is the sum of a ledger, not a stored number — which is why a balance
                  can always be explained, and never silently disagrees with its own history.
                </p>
              </div>
              {caps.config ? (
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'accrual' })}>
                    <Icon name="calendar" size={14} />
                    Run accrual
                  </button>
                  <button className="btn btn-sm" onClick={() => setOpen({ kind: 'credit' })}>
                    Credit the year
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'adjust' })}>
                    <Icon name="plus" size={14} />
                    Adjust
                  </button>
                </div>
              ) : null}
            </div>

            <input
              className="mb-3 max-w-[240px]"
              type="search"
              placeholder="Find an employee…"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            />

            {staff.length === 0 || types.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={types.length === 0 ? 'No leave types yet' : 'No active employees'}
                body={
                  types.length === 0
                    ? 'Leave types carry the policy — accrual, carry forward, probation, document thresholds. They are configured under Settings.'
                    : 'Balances follow the employee list.'
                }
                action={
                  types.length === 0 ? (
                    <Link href="/settings" className="btn btn-primary">
                      Open Settings
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                      <th className="p-2.5 font-semibold">Employee</th>
                      {types.filter((t) => t.is_active).map((t) => (
                        <th key={t.id} className="p-2.5 text-right font-semibold" title={t.name}>
                          {t.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStaff.map((s) => (
                      <tr key={s.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                        <td className="p-2.5">
                          <b className="block font-semibold text-ink">{s.full_name}</b>
                          <span className="text-[11px] text-slate-muted">
                            {s.employee_code}
                            {s.department ? ` · ${s.department}` : ''}
                          </span>
                        </td>
                        {types.filter((t) => t.is_active).map((t) => {
                          const b = balByEmp.get(s.id)?.get(t.id);
                          const bal = Number(b?.balance ?? 0);
                          return (
                            <td
                              key={t.id}
                              className={`p-2.5 text-right tabular-nums ${bal < 0 ? 'font-semibold text-red-600' : bal === 0 ? 'text-slate-faint' : 'text-ink'}`}
                              title={b ? `credited ${b.credited}, taken ${Math.abs(Number(b.debited))}` : 'no entries'}
                            >
                              {b ? fmt(bal) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm">Recent ledger entries</h3>
            {ledger.length === 0 ? (
              <p className="text-[13px] text-slate-muted">Nothing yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {ledger.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">{l.employee_name}</b>
                      <span className="block text-[11px] text-slate-muted">
                        {typeName(l.leave_type_id)} · {dateLabel(l.entry_date)} · {l.reason.replace(/_/g, ' ')}
                        {l.note ? ` · ${l.note}` : ''}
                      </span>
                    </div>
                    <span className={`text-[13px] font-semibold tabular-nums ${Number(l.delta) < 0 ? 'text-red-600' : 'text-leaf-text'}`}>
                      {Number(l.delta) > 0 ? '+' : ''}
                      {fmt(Number(l.delta))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- holidays */}
      {tab === 'Holidays' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Holiday calendar {year}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                Holidays are excluded when an application is counted, so a two-day break across a
                public holiday costs one day of leave, not two.
              </p>
            </div>
            {caps.config ? (
              <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'holiday' })}>
                <Icon name="plus" size={14} />
                Add
              </button>
            ) : null}
          </div>
          {holidays.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
              Nothing on the calendar for {year}.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {holidays.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">{h.name}</b>
                    <span className="block text-[11px] text-slate-muted">
                      {dateLabel(h.holiday_date)}
                      {h.is_optional ? ' · optional' : ''}
                      {h.location_id ? ` · ${locations.find((l) => l.value === h.location_id)?.label ?? 'one location'}` : ' · all locations'}
                    </span>
                  </div>
                  {caps.config ? (
                    <>
                      <button className="btn btn-sm" onClick={() => setOpen({ kind: 'holiday', holiday: h })}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => deleteHoliday(h.id))}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      {open?.kind === 'reject' && open.req ? (
        <Modal title="Reject this application" sub="The employee sees your reason" onClose={close}>
          <RecordForm
            fields={[{ name: 'comment', label: 'Why?', type: 'textarea', rules: [V.required('Reason')] }]}
            action={(vals: Values) =>
              decideApproval({
                id: open.req!.approval_request_id as string,
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

      {open?.kind === 'cancel' && open.req ? (
        <ConfirmModal
          title="Cancel this leave"
          body={
            <>
              {open.req.employee_name}&apos;s {open.req.days} day(s) from {dateLabel(open.req.from_date)} will be
              cancelled and the balance refunded to the ledger.
            </>
          }
          confirmLabel="Cancel the leave"
          busy={busy}
          onConfirm={() => run(() => cancelLeaveFor(open.req!.id))}
          onClose={close}
        />
      ) : null}

      {open?.kind === 'adjust' ? (
        <Modal title="Adjust a balance" sub="Every adjustment is a ledger entry with your name on it" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'employee_id', label: 'Employee', type: 'select', rules: [V.required('Employee')],
                options: staff.map((s) => ({ value: s.id, label: `${s.full_name} (${s.employee_code})` })),
              },
              {
                name: 'leave_type_id', label: 'Leave type', type: 'select', rules: [V.required('Leave type')],
                options: types.filter((t) => t.is_active).map((t) => ({ value: t.id, label: t.name })),
              },
              {
                name: 'delta', label: 'Days', type: 'number', rules: [V.required('Days')], half: true,
                hint: 'Positive adds days, negative takes them away. Half days are allowed.',
              },
              { name: 'reason', label: 'Reason', type: 'select', options: REASON_OPTIONS, half: true },
              { name: 'entry_date', label: 'Effective date', type: 'date', half: true },
              { name: 'note', label: 'Note', rules: [V.required('Note')], placeholder: 'Comp off for the Saturday release' },
            ]}
            initial={{ reason: 'adjustment', entry_date: today }}
            action={adjustLeaveBalance}
            submitLabel="Post the entry"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'accrual' ? (
        <Modal
          title="Run accrual"
          sub="The monthly credit, and at the start of a leave year the carry-forward and lapse too"
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'period_month',
                label: 'Month',
                type: 'month',
                rules: [V.required('Month'), V.periodMonth],
                hint: 'Run it on or after the first of the month. Running it late is fine — the entries are dated to the month they are for.',
              },
            ]}
            initial={{ period_month: new Date().toISOString().slice(0, 7) }}
            action={runLeaveAccrual}
            submitLabel="Run it"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Safe to press twice. Each entry is keyed to the period it is for, so a second run
                credits nobody again. It respects probation, gives a mid-year joiner a pro-rata
                entitlement, and at the start of a leave year carries forward what the cap allows
                and lapses the rest as its own visible entry.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'credit' ? (
        <Modal title="Credit a leave year" sub="One entry per active employee" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'leave_type_id', label: 'Leave type', type: 'select', rules: [V.required('Leave type')],
                options: types.filter((t) => t.is_active).map((t) => ({
                  value: t.id,
                  label: `${t.name}${t.days_per_year ? ` — policy says ${t.days_per_year} a year` : ''}`,
                })),
              },
              { name: 'leave_year', label: 'Year', type: 'number', rules: [V.required('Year'), V.positiveInt('Year')], half: true },
              { name: 'days', label: 'Days to credit', type: 'number', rules: [V.required('Days')], half: true },
            ]}
            initial={{ leave_year: String(year), days: '' }}
            action={creditLeaveYear}
            submitLabel="Credit everybody"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Safe to run twice: anyone who already has an accrual entry for that type and year is
                skipped, so nobody is credited double.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'holiday' ? (
        <Modal title={open.holiday ? 'Edit holiday' : 'Add a holiday'} onClose={close}>
          <RecordForm
            fields={[
              { name: 'holiday_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
              { name: 'name', label: 'Name', rules: [V.required('Name')], placeholder: 'Diwali', half: true },
              {
                name: 'location_id', label: 'Applies to', type: 'select',
                options: [{ value: '', label: 'Every location' }, ...locations],
                hint: 'Regional holidays differ by state, so a holiday can belong to one location.',
              },
              {
                name: 'is_optional', label: 'Optional — employees choose whether to take it', type: 'switch',
              },
            ]}
            initial={{
              holiday_date: open.holiday?.holiday_date ?? '',
              name: open.holiday?.name ?? '',
              location_id: open.holiday?.location_id ?? '',
              is_optional: open.holiday?.is_optional ?? false,
            }}
            action={(vals: Values) => saveHoliday({ ...vals, id: open.holiday?.id ?? '' })}
            submitLabel="Save holiday"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

function daysUntil(date: string): string {
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
