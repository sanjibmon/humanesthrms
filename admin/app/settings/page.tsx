import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity } from '@/lib/guard';
import { hasServiceRole } from '@/lib/supabase/admin';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

/* statutory_rules is a versioned key/value store: one row per rule key per
   effective date, with the citation that justifies the number. */
type Rule = {
  id: string;
  rule_key: string;
  value: unknown;
  effective_from: string;
  status: string;
  source: string | null;
  note: string | null;
  verified_on: string | null;
};

const GROUP_LABEL: Record<string, string> = {
  epf: 'Provident Fund',
  esi: 'Employee State Insurance',
  pt: 'Professional Tax',
  lwf: 'Labour Welfare Fund',
  tds: 'Income Tax / TDS',
  gratuity: 'Gratuity',
  bonus: 'Statutory Bonus',
};

const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

function Health({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 shrink-0 ${ok ? 'text-leaf-text' : 'text-amber-text'}`}>
        <Icon name={ok ? 'checkcircle' : 'alert'} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[13px] font-semibold text-ink">{label}</b>
        <span className="text-[12px] leading-relaxed text-slate-muted">{detail}</span>
      </div>
      <span className={`badge ${ok ? 'bg-leaf-soft text-leaf-text' : 'bg-amber-bg text-amber-text'}`}>
        {ok ? 'ready' : 'action needed'}
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: rules }, { count: orgCount }, { count: staffCount }] = await Promise.all([
    supabase
      .from('statutory_rules')
      .select('id,rule_key,value,effective_from,status,source,note,verified_on')
      .order('rule_key')
      .order('effective_from', { ascending: false }),
    supabase.from('organizations').select('id', { count: 'exact', head: true }),
    supabase.from('platform_users').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  const ruleRows = (rules ?? []) as Rule[];
  const byType = new Map<string, Rule[]>();
  for (const r of ruleRows) {
    const group = r.rule_key.split('.')[0];
    const list = byType.get(group) ?? [];
    list.push(r);
    byType.set(group, list);
  }

  const serviceRole = hasServiceRole();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;

  return (
    <AdminShell current="/settings">
      <PageHead title="Settings" sub="Platform configuration, statutory reference data and environment health" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Statutory Areas" value={byType.size} foot={`${ruleRows.length} rules on file`} icon="shieldcheck" accent="brand" />
        <Kpi label="Active Staff" value={staffCount ?? 0} foot="Can sign in to this portal" icon="users" accent="leaf" />
        <Kpi label="Customers" value={orgCount ?? 0} foot="All statuses" icon="building" accent="amber" />
        <Kpi label="Your Role" value={me ? me.role.replace('_', ' ') : '—'} foot={`${me?.permissions.length ?? 0} permissions`} icon="lock" accent="slate" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-sm">Environment</h3>
          <p className="mb-2 text-xs text-slate-muted">
            Checked at request time against what this deployment can actually see.
          </p>
          <div className="divide-y divide-slate-line2">
            <Health
              ok={serviceRole}
              label="Service role key"
              detail={
                serviceRole
                  ? 'Present — invitations and first-owner provisioning work.'
                  : 'Missing. Add SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy. Without it, nobody can be invited by email.'
              }
            />
            <Health
              ok={Boolean(siteUrl)}
              label="Public site URL"
              detail={
                siteUrl
                  ? `Invitation links point at ${siteUrl}.`
                  : 'Not set. Add NEXT_PUBLIC_SITE_URL so invitation emails link back to this portal rather than localhost.'
              }
            />
            <Health
              ok={Boolean(me)}
              label="Your session"
              detail={
                me
                  ? `Signed in as ${me.email} with an authenticator-verified session.`
                  : 'Not recognised as a platform user, or the authenticator step is incomplete.'
              }
            />
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm">Email delivery</h3>
          <p className="mb-3 text-xs text-slate-muted">
            Supabase&rsquo;s built-in mailer sends only a few messages an hour and is not meant for
            production. Point it at your own SMTP before inviting real customers.
          </p>
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] leading-relaxed text-slate-body">
            <li>Create a Resend account and verify <b>humanest.co.in</b> by adding the DNS records it gives you.</li>
            <li>Create an API key.</li>
            <li>
              In Supabase → Project Settings → Authentication → SMTP Settings, turn on custom SMTP and
              enter host <code>smtp.resend.com</code>, port <code>465</code>, username{' '}
              <code>resend</code>, and the API key as the password.
            </li>
            <li>
              Set the sender to something you own, for example{' '}
              <code>HumaNest &lt;no-reply@humanest.co.in&gt;</code>.
            </li>
            <li>
              In Authentication → URL Configuration, add this portal and the customer portal to
              Redirect URLs.
            </li>
          </ol>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm">Statutory reference data</h3>
        <p className="mb-3.5 text-xs text-slate-muted">
          What the payroll engine computes from. Every rule is versioned by effective date, so a
          historical pay run always recomputes on the rules that applied at the time.
        </p>

        {ruleRows.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
            No statutory rules are visible to this session.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {[...byType.entries()].map(([group, list]) => (
              <div key={group}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <b className="text-[13px] text-ink">{GROUP_LABEL[group] ?? group.toUpperCase()}</b>
                  <span className="badge">{list.length} rule(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th className="text-right">Value</th>
                        <th>In force from</th>
                        <th>Status</th>
                        <th>Authority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td className="font-mono text-[12px] text-ink">{r.rule_key}</td>
                          <td className="text-right font-semibold tabular-nums text-ink">{show(r.value)}</td>
                          <td>{dateLabel(r.effective_from)}</td>
                          <td>
                            <span
                              className={`badge ${
                                r.status === 'in_force'
                                  ? 'bg-leaf-soft text-leaf-text'
                                  : 'bg-amber-bg text-amber-text'
                              }`}
                            >
                              {r.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="max-w-[360px] text-[11px] leading-snug text-slate-muted">
                            {r.source ?? '—'}
                            {r.note ? <span className="block italic">{r.note}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[12px] leading-relaxed text-amber-text">
          <span className="mt-0.5 shrink-0">
            <Icon name="alert" size={15} />
          </span>
          <span>
            The EPFO wage ceiling of &#8377;25,000 was a Cabinet decision on 16 September 2026 with no
            effective date attached. The engine holds &#8377;15,000 until the Gazette notification, and
            payroll shows a banner saying so. Professional Tax and Labour Welfare Fund figures for the
            launch states came from secondary sources and should be checked against each state&rsquo;s
            own notification before you bill a customer on them.
          </span>
        </div>
      </div>
    </AdminShell>
  );
}
