'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel, inr } from '@/lib/format';
import * as V from '@/lib/validate';
import { decideApproval, markAllNotificationsRead } from '@/app/actions/approvals';

export type StepRow = {
  id: string;
  level: number;
  approver_type: string;
  approver_employee_id: string | null;
  approver_permission: string | null;
  status: string;
  comment: string | null;
  acted_at: string | null;
  due_at: string | null;
  approver_name: string | null;
};

export type RequestRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  requester_employee_id: string | null;
  requester_name: string | null;
  status: string;
  current_level: number;
  created_at: string;
  decided_at: string | null;
  /** One line describing what is being asked for, built from the source record. */
  summary: string;
  detail: string | null;
  steps: StepRow[];
  /** True when a step at the current level is waiting on this viewer. */
  mine: boolean;
};

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const ENTITY_LABEL: Record<string, string> = {
  leave: 'Leave',
  regularization: 'Attendance regularisation',
  profile_change: 'Profile change',
  expense: 'Expense claim',
  loan: 'Loan or advance',
  exit: 'Resignation',
  requisition: 'Hiring requisition',
  offer: 'Offer',
  other: 'Request',
};

const ENTITY_ICON: Record<string, 'calendar' | 'clock' | 'receipt' | 'user' | 'briefcase' | 'file'> = {
  leave: 'calendar',
  regularization: 'clock',
  expense: 'receipt',
  profile_change: 'user',
  exit: 'user',
  requisition: 'briefcase',
  offer: 'briefcase',
  loan: 'receipt',
  other: 'file',
};

const STEP_CLASS: Record<string, string> = {
  approved: 'bg-leaf-soft text-leaf-text',
  rejected: 'bg-red-50 text-red-700',
  pending: 'bg-amber-bg text-amber-text',
  skipped: 'bg-slate-line2 text-slate-muted',
  forwarded: 'bg-brand-soft text-brand-dark',
};

const APPROVER_LABEL: Record<string, string> = {
  manager: 'Reporting manager',
  hr: 'HR',
  dept_head: 'Department head',
  finance: 'Finance',
  employee: 'Forwarded to',
};

type Tab = 'For me' | 'My requests' | 'All pending' | 'Decided';

export function InboxConsole({
  waiting,
  mine,
  allPending,
  decided,
  notifications,
  people,
  canSeeAll,
}: {
  waiting: RequestRow[];
  mine: RequestRow[];
  allPending: RequestRow[];
  decided: RequestRow[];
  notifications: NotificationRow[];
  people: { value: string; label: string }[];
  canSeeAll: boolean;
}) {
  const router = useRouter();
  const tabs: Tab[] = canSeeAll
    ? ['For me', 'My requests', 'All pending', 'Decided']
    : ['For me', 'My requests', 'Decided'];
  const [tab, setTab] = useState<Tab>('For me');
  const [acting, setActing] = useState<{ row: RequestRow; decision: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows =
    tab === 'For me' ? waiting : tab === 'My requests' ? mine : tab === 'All pending' ? allPending : decided;

  const unread = notifications.filter((n) => !n.read_at);

  async function clearNotifications() {
    setBusy(true);
    const res = await markAllNotificationsRead();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  const decideFields: FieldDef[] = [
    {
      name: 'forward_to',
      label: 'Forward to',
      type: 'select',
      options: people,
      rules: [V.required('Somebody to forward to')],
      hint: 'They become a new approval level. The chain continues from there.',
    },
    {
      name: 'comment',
      label: 'Comment',
      type: 'textarea',
      hint: 'The requester can read this.',
    },
  ];

  return (
    <>
      {unread.length ? (
        <div className="card mb-5">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Notifications</h3>
              <p className="mt-0.5 text-xs text-slate-muted">{unread.length} unread</p>
            </div>
            <button className="btn btn-sm" onClick={clearNotifications} disabled={busy}>
              Mark all read
            </button>
          </div>
          <div className="flex flex-col divide-y divide-slate-line2">
            {unread.slice(0, 6).map((n) => (
              <div key={n.id} className="py-2.5">
                <b className="block text-[13px] font-semibold text-ink">{n.title}</b>
                {n.body ? <span className="text-[12px] text-slate-muted">{n.body}</span> : null}
                <span className="mt-0.5 block text-[11px] text-slate-faint">{dateLabel(n.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="tabbar mb-5">
        {tabs.map((t) => (
          <button
            key={t}
            className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'For me' && waiting.length ? (
              <span className="ml-1.5 rounded-full bg-amber-bg px-1.5 text-[11px] font-semibold text-amber-text">
                {waiting.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={
            tab === 'For me'
              ? 'Nothing is waiting on you'
              : tab === 'My requests'
                ? 'You have not raised anything'
                : tab === 'All pending'
                  ? 'Nothing is pending anywhere'
                  : 'Nothing has been decided yet'
          }
          body={
            tab === 'For me'
              ? 'Leave, regularisation, expense and exit requests appear here when they reach a level you approve. Each one carries its own chain — manager, then HR, then department head for long leave.'
              : 'Requests you raise from the self-service pages appear here with their approval chain, so you can see exactly who is holding them up.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              row={r}
              onDecide={(decision) => setActing({ row: r, decision })}
            />
          ))}
        </div>
      )}

      {acting ? (
        <Modal
          title={
            acting.decision === 'approve'
              ? 'Approve this request'
              : acting.decision === 'reject'
                ? 'Reject this request'
                : 'Forward for a decision'
          }
          sub={acting.row.summary}
          onClose={() => setActing(null)}
        >
          <RecordForm
            fields={
              acting.decision === 'forward'
                ? decideFields
                : [
                    {
                      name: 'comment',
                      label: acting.decision === 'reject' ? 'Reason for rejecting' : 'Comment',
                      type: 'textarea',
                      rules: acting.decision === 'reject' ? [V.required('A reason')] : [],
                      hint: 'The requester can read this.',
                    },
                  ]
            }
            action={(vals: Values) =>
              decideApproval({ ...vals, id: acting.row.id, decision: acting.decision })
            }
            submitLabel={
              acting.decision === 'approve'
                ? 'Approve'
                : acting.decision === 'reject'
                  ? 'Reject'
                  : 'Forward'
            }
            onDone={() => setActing(null)}
            onCancel={() => setActing(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}

function RequestCard({
  row,
  onDecide,
}: {
  row: RequestRow;
  onDecide: (decision: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const overdue = row.steps.some(
    (s) => s.status === 'pending' && s.due_at && new Date(s.due_at) < new Date(),
  );

  return (
    <div className="card">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={row.requester_name ?? ENTITY_LABEL[row.entity_type]} slate={row.status !== 'pending'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13px] font-semibold text-ink">
              {ENTITY_LABEL[row.entity_type] ?? row.entity_type}
            </b>
            <span className={`badge ${STEP_CLASS[row.status] ?? ''}`}>{row.status}</span>
            {overdue ? <span className="badge bg-red-50 text-red-700">overdue</span> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-ink">{row.summary}</p>
          <p className="mt-0.5 text-[11px] text-slate-muted">
            {row.requester_name ? `${row.requester_name} · ` : ''}raised {dateLabel(row.created_at)}
            {row.decided_at ? ` · decided ${dateLabel(row.decided_at)}` : ''}
          </p>
          {row.detail ? (
            <p className="mt-1.5 rounded-xl bg-slate-surface px-3 py-2 text-[12px] leading-relaxed text-slate-body">
              {row.detail}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            <Icon name={ENTITY_ICON[row.entity_type] ?? 'file'} size={14} />
            {open ? 'Hide chain' : 'Chain'}
          </button>
          {row.mine && row.status === 'pending' ? (
            <>
              <button className="btn btn-sm" onClick={() => onDecide('forward')}>
                Forward
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => onDecide('reject')}>
                Reject
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => onDecide('approve')}>
                Approve
              </button>
            </>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-3.5 border-t border-slate-line2 pt-3">
          <ol className="flex flex-col gap-2.5">
            {row.steps
              .slice()
              .sort((a, b) => a.level - b.level)
              .map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2.5 text-[12px]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-line2 text-[11px] font-semibold text-slate-muted">
                    {s.level}
                  </span>
                  <span className="font-semibold text-ink">
                    {APPROVER_LABEL[s.approver_type] ?? s.approver_type}
                  </span>
                  <span className="text-slate-muted">
                    {s.approver_name ??
                      (s.approver_permission ? `anyone with ${s.approver_permission}` : 'unassigned')}
                  </span>
                  <span className={`badge ${STEP_CLASS[s.status] ?? ''}`}>{s.status}</span>
                  {s.acted_at ? (
                    <span className="text-slate-faint">{dateLabel(s.acted_at)}</span>
                  ) : s.due_at ? (
                    <span className="text-slate-faint">due {dateLabel(s.due_at)}</span>
                  ) : null}
                  {s.comment ? <span className="w-full text-slate-body">&ldquo;{s.comment}&rdquo;</span> : null}
                </li>
              ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Shared by the inbox and the self-service pages so a claim reads the same in both. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? inr(v) : '—';
}
