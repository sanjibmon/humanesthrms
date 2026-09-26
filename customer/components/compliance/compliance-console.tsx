'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Kpi, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { inr, dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { FILING_LABEL } from '@/lib/filings';
import {
  generateFilings, exportFiling, prepareFiling, markFilingFiled, addManualFiling,
} from '@/app/actions/compliance';

export type FilingRow = {
  id: string;
  filing_type: string;
  state_code: string | null;
  period: string;
  due_date: string;
  status: string;
  amount: number | null;
  reference_no: string | null;
  filed_on: string | null;
  notes: string | null;
  entity_id: string | null;
};

export type AuditRow = {
  id: string;
  action: string;
  entity_type: string | null;
  created_at: string;
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-slate-line2 text-slate-muted',
  prepared: 'bg-amber-bg text-amber-text',
  filed: 'bg-leaf-soft text-leaf-text',
};

const today = () => new Date().toISOString().slice(0, 10);

/** How a due date reads to somebody deciding what to do this morning. */
function due(d: string, status: string): { label: string; tone: string } {
  if (status === 'filed') return { label: 'filed', tone: 'text-slate-muted' };
  const days = Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, tone: 'text-red-600 font-semibold' };
  if (days === 0) return { label: 'due today', tone: 'text-red-600 font-semibold' };
  if (days <= 7) return { label: `due in ${days} day${days === 1 ? '' : 's'}`, tone: 'text-amber-text font-semibold' };
  return { label: `due ${dateLabel(d)}`, tone: 'text-slate-muted' };
}

export function ComplianceConsole({
  filings,
  audit,
  entities,
  chainVerified,
  caps,
}: {
  filings: FilingRow[];
  audit: AuditRow[];
  entities: { value: string; label: string }[];
  chainVerified: boolean | null;
  caps: { file: boolean; audit: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'Filings' | 'Audit log'>('Filings');
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState<{ kind: string; row?: FilingRow } | null>(null);
  const [built, setBuilt] = useState<
    | { filename: string; content: string; mime: string; problems: string[]; notes: string[]; rowCount: number; row: FilingRow }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const shown = useMemo(() => {
    const rows =
      filter === 'open'
        ? filings.filter((f) => f.status !== 'filed')
        : filter
          ? filings.filter((f) => f.status === filter)
          : filings;
    return [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [filings, filter]);

  const overdue = filings.filter((f) => f.status !== 'filed' && f.due_date < today()).length;
  const soon = filings.filter(
    (f) => f.status !== 'filed' && f.due_date >= today() && f.due_date <= addDays(today(), 7),
  ).length;
  const filedThisYear = filings.filter((f) => f.status === 'filed').length;

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

  async function doExport(row: FilingRow) {
    setBusy(true);
    const res = await exportFiling(row.id);
    setBusy(false);
    if (!res.ok) {
      toast(res.error, true);
      return;
    }
    setBuilt({ ...res, row });
  }

  function download() {
    if (!built) return;
    const url = URL.createObjectURL(new Blob([built.content], { type: `${built.mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = built.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Overdue" value={overdue} foot={overdue ? 'file these first' : 'nothing late'} icon="alert" accent={overdue ? 'amber' : 'leaf'} />
        <Kpi label="Due this week" value={soon} foot="within seven days" icon="calendar" accent="brand" />
        <Kpi label="Filed" value={filedThisYear} foot="with an acknowledgement on record" icon="checkcircle" accent="leaf" />
        <Kpi
          label="Audit chain"
          value={chainVerified === null ? '—' : chainVerified ? 'Intact' : 'Broken'}
          foot={chainVerified === false ? 'history has been altered' : 'rows are hash-chained'}
          icon="shieldcheck"
          accent={chainVerified === false ? 'amber' : 'slate'}
        />
      </div>

      <div className="tabbar mb-5">
        {(['Filings', 'Audit log'] as const).map((t) => (
          <button
            key={t}
            className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Filings' && overdue ? (
              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-[11px] font-semibold text-red-700">
                {overdue}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'Filings' ? (
        <div className="card">
          <div className="mb-3.5 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Statutory calendar</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                Every file here is built from pay runs that are <b>locked or paid</b>. A run that is
                only computed can still change, and a return filed on figures that later move is a
                revised return and a penalty — so those are excluded rather than warned about.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="max-w-[150px]"
                value={filter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
              >
                <option value="open">Still open</option>
                <option value="">Everything</option>
                <option value="pending">Pending</option>
                <option value="prepared">Prepared</option>
                <option value="filed">Filed</option>
              </select>
              {caps.file ? (
                <>
                  <button className="btn btn-sm" onClick={() => setOpen({ kind: 'manual' })}>
                    <Icon name="plus" size={14} />
                    Add
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'generate' })}>
                    Build the month
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {filings.length === 0 ? (
            <EmptyState
              icon="shieldcheck"
              title="Nothing on the calendar yet"
              body="Build a month and every obligation for it appears with its own due date — provident fund, ESI, professional tax per state, and TDS. Running it twice is safe."
              action={
                caps.file ? (
                  <button className="btn btn-primary" onClick={() => setOpen({ kind: 'generate' })}>
                    Build the month
                  </button>
                ) : undefined
              }
            />
          ) : shown.length === 0 ? (
            <p className="text-[13px] text-slate-muted">Nothing with that status.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                    <th className="p-2.5 font-semibold">Return</th>
                    <th className="p-2.5 font-semibold">Period</th>
                    <th className="p-2.5 font-semibold">Due</th>
                    <th className="p-2.5 text-right font-semibold">Amount</th>
                    <th className="p-2.5 font-semibold">Status</th>
                    <th className="p-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => {
                    const d = due(f.due_date, f.status);
                    return (
                      <tr key={f.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                        <td className="p-2.5">
                          <b className="block font-semibold text-ink">
                            {FILING_LABEL[f.filing_type] ?? f.filing_type}
                          </b>
                          {f.state_code ? (
                            <span className="text-[11px] text-slate-muted">{f.state_code}</span>
                          ) : null}
                          {f.notes ? (
                            <span className="block text-[11px] leading-relaxed text-amber-text">{f.notes}</span>
                          ) : null}
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-slate-muted">{f.period}</td>
                        <td className={`p-2.5 whitespace-nowrap text-[12px] ${d.tone}`}>
                          {d.label}
                          {f.filed_on ? (
                            <span className="block text-[11px] text-slate-muted">
                              {dateLabel(f.filed_on)} · {f.reference_no}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          {f.amount === null ? '—' : inr(Number(f.amount))}
                        </td>
                        <td className="p-2.5">
                          <span className={`badge ${STATUS_CLASS[f.status] ?? ''}`}>{f.status}</span>
                        </td>
                        <td className="p-2.5">
                          <div className="flex justify-end gap-2">
                            <button className="btn btn-sm" disabled={busy} onClick={() => doExport(f)}>
                              <Icon name="file" size={14} />
                              Build file
                            </button>
                            {caps.file && f.status !== 'filed' ? (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => setOpen({ kind: f.status === 'pending' ? 'prepare' : 'file', row: f })}
                              >
                                {f.status === 'pending' ? 'Prepared' : 'Mark filed'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'Audit log' ? (
        <div className="card">
          <h3 className="mb-1 text-sm">Audit log</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            Every change records who made it and when. Rows are hash-chained, so an edit to history
            breaks the chain and is detectable rather than silent. Exporting a filing that reveals
            PANs writes a row here naming the filing.
          </p>
          {!caps.audit ? (
            <p className="text-[13px] text-slate-muted">Your role cannot read the audit log.</p>
          ) : audit.length === 0 ? (
            <p className="text-[13px] text-slate-muted">Nothing recorded yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="font-mono text-[12px] text-ink">{a.action}</span>
                  <span className="text-slate-muted">{a.entity_type}</span>
                  <span className="ml-auto text-[11px] text-slate-muted">{dateLabel(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      {built ? (
        <Modal
          title={built.filename}
          sub={`${built.rowCount} row${built.rowCount === 1 ? '' : 's'} · ${FILING_LABEL[built.row.filing_type] ?? built.row.filing_type}`}
          wide
          onClose={() => setBuilt(null)}
          footer={
            <>
              <button className="btn" onClick={() => setBuilt(null)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={download}>
                <Icon name="file" size={14} />
                Download
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {built.problems.length ? (
              <div className="rounded-xl bg-amber-bg px-3 py-2.5">
                <b className="text-xs uppercase tracking-wide text-amber-text">
                  Fix before filing — the portal will reject it otherwise
                </b>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-amber-text">
                  {built.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-xl bg-leaf-soft px-3 py-2 text-[12px] text-leaf-text">
                Nothing missing. The file is ready to upload.
              </p>
            )}

            {built.notes.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-slate-muted">
                {built.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}

            <div>
              <b className="text-xs uppercase tracking-wide text-slate-muted">Preview</b>
              <pre className="mt-1.5 max-h-[320px] overflow-auto rounded-xl bg-slate-surface p-3 font-mono text-[11px] leading-relaxed text-slate-body">
                {built.content.slice(0, 4000) || '(empty)'}
                {built.content.length > 4000 ? '\n…' : ''}
              </pre>
            </div>
          </div>
        </Modal>
      ) : null}

      {open?.kind === 'generate' ? (
        <Modal title="Build a month" sub="Adds every obligation for that month with its due date" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'period_month',
                label: 'Month',
                type: 'month',
                rules: [V.required('Month'), V.periodMonth],
                hint: 'The month the payroll is for, not the month the return is filed in.',
              },
            ]}
            initial={{ period_month: lastMonth() }}
            action={generateFilings}
            submitLabel="Build"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Safe to run twice — anything already on the calendar is left alone. Professional tax
                gets one row per state you employ in, because it is filed per state.
              </span>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'prepare' && open.row ? (
        <Modal
          title="Mark as prepared"
          sub={`${FILING_LABEL[open.row.filing_type] ?? open.row.filing_type} · ${open.row.period}`}
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'amount',
                label: 'What the return comes to',
                type: 'number',
                rules: [V.required('Amount'), V.nonNegative('Amount')],
                hint: 'Build the file first — the challan working gives you this figure.',
              },
              { name: 'notes', label: 'Note', placeholder: 'Checked against the March register' },
            ]}
            initial={{ amount: String(open.row.amount ?? ''), notes: open.row.notes ?? '' }}
            action={(vals: Values) => prepareFiling({ ...vals, id: open.row!.id })}
            submitLabel="Mark prepared"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'file' && open.row ? (
        <Modal
          title="Mark as filed"
          sub={`${FILING_LABEL[open.row.filing_type] ?? open.row.filing_type} · ${open.row.period}`}
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'reference_no',
                label: 'Acknowledgement or challan number',
                rules: [V.required('Reference')],
                hint: 'What the portal gave you back. This is the thing an inspector asks for.',
              },
              { name: 'filed_on', label: 'Filed on', type: 'date', rules: [V.required('Date')], half: true },
              { name: 'amount', label: 'Amount paid', type: 'number', rules: [V.nonNegative('Amount')], half: true },
              { name: 'notes', label: 'Note' },
            ]}
            initial={{
              filed_on: today(),
              amount: String(open.row.amount ?? ''),
              reference_no: open.row.reference_no ?? '',
              notes: open.row.notes ?? '',
            }}
            action={(vals: Values) => markFilingFiled({ ...vals, id: open.row!.id })}
            submitLabel="Mark filed"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'manual' ? (
        <Modal title="Add a filing" sub="For an obligation the calendar does not generate" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'filing_type',
                label: 'Return',
                type: 'select',
                options: Object.entries(FILING_LABEL).map(([value, label]) => ({ value, label })),
                rules: [V.required('Return')],
              },
              { name: 'period', label: 'Period', rules: [V.required('Period')], placeholder: '2026-08 or FY2026-27-Q2', half: true },
              { name: 'due_date', label: 'Due', type: 'date', rules: [V.required('Due date')], half: true },
              { name: 'state_code', label: 'State', transform: 'upper', placeholder: 'MH', half: true, hint: 'Only for a state return.' },
              {
                name: 'entity_id',
                label: 'Legal entity',
                type: 'select',
                options: [{ value: '', label: 'The default entity' }, ...entities],
                half: true,
              },
              { name: 'notes', label: 'Note' },
            ]}
            initial={{ filing_type: 'lwf_return', period: lastMonth() }}
            action={addManualFiling}
            submitLabel="Add"
            onDone={close}
            onCancel={close}
            note={
              <span>
                The labour welfare fund is the usual reason to use this: it is half-yearly in some
                states and annual in others, so the calendar does not invent monthly rows for it.
              </span>
            }
          />
        </Modal>
      ) : null}
    </>
  );
}

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
