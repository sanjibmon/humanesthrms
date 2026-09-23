import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { Icon } from '@/components/icon';
import { UserConsole, type StaffRow } from '@/components/platform/user-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';

export const dynamic = 'force-dynamic';

const ROLES = ['super_admin', 'sales', 'finance', 'support'];
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  sales: 'Sales',
  finance: 'Finance',
  support: 'Support',
};

export default async function UsersPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: users }, { data: perms }, { data: rolePerms }] = await Promise.all([
    supabase
      .from('platform_users')
      .select('id,email,full_name,role,is_active,last_login_at,created_at')
      .order('created_at'),
    supabase.from('platform_permissions').select('code,description').order('code'),
    supabase.from('platform_role_permissions').select('role,permission'),
  ]);

  const rows = (users ?? []) as StaffRow[];
  const permissions = (perms ?? []) as { code: string; description: string }[];
  const matrix = new Set(
    ((rolePerms ?? []) as { role: string; permission: string }[]).map((r) => `${r.role}|${r.permission}`),
  );

  return (
    <AdminShell current="/users">
      <PageHead
        title="Platform Users & RBAC"
        sub="The HumaNest team signs in through one URL — admin.humanest.co.in"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Staff Accounts" value={rows.length} foot="Across all four roles" icon="users" accent="brand" />
        <Kpi label="Super Admins" value={rows.filter((u) => u.role === 'super_admin').length} foot="Full control" icon="shieldcheck" accent="amber" />
        <Kpi label="Active" value={rows.filter((u) => u.is_active).length} foot="Can sign in today" icon="checkcircle" accent="leaf" />
        <Kpi label="Never Signed In" value={rows.filter((u) => !u.last_login_at).length} foot="Invitation still open" icon="clock" accent="slate" />
      </div>

      <div className="mb-5">
        <UserConsole rows={rows} canWrite={can(me, 'manage_platform_users')} myId={me?.userId ?? ''} />
      </div>

      <div className="card">
        <h3 className="text-sm">Permission matrix</h3>
        <p className="mb-3.5 text-xs text-slate-muted">
          Read live from <code>platform_role_permissions</code> — the same table row level security
          consults on every query. Changing a role here changes what the database itself will allow.
        </p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.code}>
                  <td>
                    <b className="block font-semibold text-ink">{p.code.replace(/_/g, ' ')}</b>
                    <span className="text-[11px] text-slate-muted">{p.description}</span>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">
                      {matrix.has(`${r}|${p.code}`) ? (
                        <span className="inline-flex text-leaf-text">
                          <Icon name="checkcircle" size={16} />
                        </span>
                      ) : (
                        <span className="text-slate-faint">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
