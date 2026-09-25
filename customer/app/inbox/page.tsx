import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  InboxConsole,
  type RequestRow,
  type StepRow,
  type NotificationRow,
} from '@/components/approvals/inbox-console';
import { dateLabel, inr } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';
  const me = v.employeeId;

  /* approvals_select already limits this to requests the viewer raised, requests
     they are a step approver on, and — with approvals.read — everything in the
     organisation. So no filter here is the security boundary; the split into
     tabs below is presentation. */
  const [{ data: reqs }, { data: steps }, { data: notifs }, { data: people }] = await Promise.all([
    supabase
      .from('approval_requests')
      .select('id,entity_type,entity_id,requester_employee_id,status,current_level,payload,created_at,decided_at')
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('approval_steps')
      .select('id,request_id,level,approver_type,approver_employee_id,approver_permission,status,comment,acted_at,due_at')
      .eq('org_id', org)
      .limit(1500),
    supabase
      .from('notifications')
      .select('id,kind,title,body,link,read_at,created_at')
      .eq('user_id', v.userId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase.from('employees').select('id,full_name,employee_code').eq('org_id', org).neq('status', 'exited'),
  ]);

  const requests = (reqs ?? []) as {
    id: string; entity_type: string; entity_id: string; requester_employee_id: string | null;
    status: string; current_level: number; payload: Record<string, unknown> | null;
    created_at: string; decided_at: string | null;
  }[];

  const nameById = new Map(
    ((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  );

  const stepsByRequest = new Map<string, StepRow[]>();
  for (const s of (steps ?? []) as (StepRow & { request_id: string })[]) {
    const list = stepsByRequest.get(s.request_id) ?? [];
    list.push({ ...s, approver_name: s.approver_employee_id ? (nameById.get(s.approver_employee_id) ?? null) : null });
    stepsByRequest.set(s.request_id, list);
  }

  /* The source record for each request, so the card says "12 to 15 Oct, 4 days,
     Casual Leave" instead of a row of identifiers. Fetched by approval_request_id
     rather than by entity id, because that is the column each table indexes. */
  const ids = requests.map((r) => r.id);
  const [{ data: leaves }, { data: regs }, { data: claims }, { data: types }] = await Promise.all([
    ids.length
      ? supabase
          .from('leave_requests')
          .select('approval_request_id,from_date,to_date,days,half_day,reason,leave_type_id,request_no')
          .in('approval_request_id', ids)
      : Promise.resolve({ data: [] as unknown[] }),
    ids.length
      ? supabase
          .from('attendance_regularizations')
          .select('approval_request_id,work_date,request_type,requested_in,requested_out,reason')
          .in('approval_request_id', ids)
      : Promise.resolve({ data: [] as unknown[] }),
    ids.length
      ? supabase
          .from('expense_claims')
          .select('approval_request_id,claim_no,title,total')
          .in('approval_request_id', ids)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from('leave_types').select('id,code,name').eq('org_id', org),
  ]);

  const typeName = new Map(
    ((types ?? []) as { id: string; code: string; name: string }[]).map((t) => [t.id, t.name]),
  );
  const leaveBy = new Map(
    ((leaves ?? []) as any[]).map((l) => [l.approval_request_id as string, l]),
  );
  const regBy = new Map(((regs ?? []) as any[]).map((r) => [r.approval_request_id as string, r]));
  const claimBy = new Map(((claims ?? []) as any[]).map((c) => [c.approval_request_id as string, c]));

  const describe = (r: (typeof requests)[number]): { summary: string; detail: string | null } => {
    const l = leaveBy.get(r.id);
    if (l) {
      const half = l.half_day && l.half_day !== 'none' ? ` (${l.half_day} half)` : '';
      return {
        summary: `${typeName.get(l.leave_type_id) ?? 'Leave'} · ${dateLabel(l.from_date)} to ${dateLabel(l.to_date)} · ${l.days} day(s)${half}`,
        detail: l.reason ?? null,
      };
    }
    const g = regBy.get(r.id);
    if (g) {
      const t = String(g.request_type).replace(/_/g, ' ');
      return { summary: `${t} on ${dateLabel(g.work_date)}`, detail: g.reason ?? null };
    }
    const c = claimBy.get(r.id);
    if (c) {
      return {
        summary: `${c.title ?? 'Expense claim'} · ${inr(Number(c.total ?? 0))}${c.claim_no ? ` · ${c.claim_no}` : ''}`,
        detail: null,
      };
    }
    const payload = r.payload ?? {};
    const bits = Object.entries(payload)
      .map(([k, val]) => `${k}: ${String(val)}`)
      .join(' · ');
    return { summary: bits || 'No further detail recorded', detail: null };
  };

  const rows: RequestRow[] = requests.map((r) => {
    const mySteps = stepsByRequest.get(r.id) ?? [];
    const current = mySteps.find((s) => s.level === r.current_level && s.status === 'pending');
    /* Mirrors app.decide_approval: the step is yours if it names you, or if it
       names a permission you hold — and never if you raised it yourself. */
    const isMine =
      Boolean(current) &&
      r.status === 'pending' &&
      r.requester_employee_id !== me &&
      ((current!.approver_employee_id !== null && current!.approver_employee_id === me) ||
        (current!.approver_permission !== null && v.can(current!.approver_permission)));

    const { summary, detail } = describe(r);
    return {
      id: r.id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      requester_employee_id: r.requester_employee_id,
      requester_name: r.requester_employee_id ? (nameById.get(r.requester_employee_id) ?? null) : null,
      status: r.status,
      current_level: r.current_level,
      created_at: r.created_at,
      decided_at: r.decided_at,
      summary,
      detail,
      steps: mySteps,
      mine: isMine,
    };
  });

  const pending = rows.filter((r) => r.status === 'pending');

  return (
    <CustomerShell current="/inbox">
      <PageHead title="Inbox & Approvals" sub="Everything waiting on you, in one queue" />
      <InboxConsole
        waiting={pending.filter((r) => r.mine)}
        mine={rows.filter((r) => r.requester_employee_id && r.requester_employee_id === me)}
        allPending={pending}
        decided={rows.filter((r) => r.status !== 'pending')}
        notifications={(notifs ?? []) as NotificationRow[]}
        people={((people ?? []) as { id: string; full_name: string; employee_code: string }[])
          .filter((p) => p.id !== me)
          .map((p) => ({ value: p.id, label: `${p.full_name} (${p.employee_code})` }))}
        canSeeAll={v.can('approvals.read')}
      />
    </CustomerShell>
  );
}
