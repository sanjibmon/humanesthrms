import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { TicketConsole, type TicketRow } from '@/components/platform/ticket-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: tickets }, { data: orgs }, { data: staff }] = await Promise.all([
    supabase
      .from('platform_support_tickets')
      .select('id,ticket_no,subject,description,category,priority,status,org_id,assigned_to,created_at,resolved_at,organizations(name)')
      .order('created_at', { ascending: false }),
    supabase.from('organizations').select('id,name').order('name'),
    supabase.from('platform_users').select('id,full_name').eq('is_active', true).order('full_name'),
  ]);

  const staffRows = (staff ?? []) as { id: string; full_name: string }[];
  const nameById = new Map(staffRows.map((s) => [s.id, s.full_name]));

  const rows: TicketRow[] = ((tickets ?? []) as unknown as (Omit<TicketRow, 'org_name' | 'assignee_name'> & {
    organizations: { name: string } | null;
  })[]).map((t) => ({
    ...t,
    org_name: t.organizations?.name ?? null,
    assignee_name: t.assigned_to ? (nameById.get(t.assigned_to) ?? 'Unknown') : null,
  }));

  const openCount = rows.filter((t) => t.status === 'open').length;
  const urgent = rows.filter((t) => t.priority === 'high' && t.status !== 'resolved').length;
  const resolved = rows.filter((t) => t.status === 'resolved');

  const avgHours = resolved.length
    ? Math.round(
        resolved
          .filter((t) => t.resolved_at)
          .reduce((a, t) => a + (Date.parse(t.resolved_at as string) - Date.parse(t.created_at)) / 3600000, 0) /
          Math.max(1, resolved.filter((t) => t.resolved_at).length),
      )
    : 0;

  return (
    <AdminShell current="/support">
      <PageHead title="Support & Tickets" sub="Every customer issue, who owns it and how long it took" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open" value={openCount} foot={openCount ? 'Not started yet' : 'Nothing waiting'} icon="inbox" accent="brand" />
        <Kpi label="High Priority" value={urgent} foot="Needs action today" icon="alert" accent="amber" />
        <Kpi label="Resolved" value={resolved.length} foot="All time" icon="checkcircle" accent="leaf" />
        <Kpi label="Avg Resolution" value={avgHours ? `${avgHours}h` : '—'} foot="From raised to resolved" icon="clock" accent="slate" />
      </div>

      <TicketConsole
        rows={rows}
        customers={(orgs ?? []) as { id: string; name: string }[]}
        staff={staffRows}
        canWrite={can(me, 'support_access')}
      />
    </AdminShell>
  );
}
