import { Shell, type MenuItem } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';

export const ADMIN_MENU: MenuItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/customers', label: 'Customer Management', icon: 'building' },
  { href: '/licenses', label: 'Licenses & Plans', icon: 'card' },
  { href: '/trials', label: 'Trial Management', icon: 'clock' },
  { href: '/modules', label: 'Modules Catalog', icon: 'puzzle' },
  { href: '/users', label: 'Platform Users & RBAC', icon: 'users' },
  { href: '/support', label: 'Support & Tickets', icon: 'lifebuoy' },
  { href: '/reports', label: 'Reports & Analytics', icon: 'chart' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  support: 'Support',
  sales: 'Sales',
  finance: 'Finance',
};

export async function AdminShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Role is resolved here, after MFA, never on the login page.
  const { data: me } = await supabase
    .from('platform_users')
    .select('full_name, role')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  return (
    <Shell
      host="admin.humanest.co.in"
      brandSub="Platform Admin"
      roleLabel={ROLE_LABEL[me?.role ?? ''] ?? 'Platform'}
      userName={me?.full_name ?? user?.email ?? 'Admin'}
      userMeta={user?.email ?? ''}
      menu={ADMIN_MENU}
      current={current}
      upsell={{
        title: 'Enterprise tier',
        body: 'White-label domains, all 18 modules and a dedicated success manager.',
        cta: 'See Enterprise',
      }}
    >
      {me ? null : (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>This account is not yet a platform user.</b> Add a row to{' '}
            <code>platform_users</code> with this user&rsquo;s id and a role to unlock the
            platform permissions. Until then the pages render but the data stays empty, because
            row level security is doing its job.
          </span>
        </div>
      )}
      {children}
    </Shell>
  );
}
