import { Shell, type MenuItem } from '@/components/shell';
import { EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';

/* The employer sidebar carries every module from the production prompt.
   Payroll is flagged rupee so it renders the Indian Rupee glyph, never a dollar sign. */
export const EMPLOYER_MENU: MenuItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/inbox', label: 'Inbox & Approvals', icon: 'inbox', module: 'approvals' },
  { href: '/employees', label: 'Employees', icon: 'users', module: 'employee_core' },
  { href: '/attendance', label: 'Attendance', icon: 'clock', module: 'attendance' },
  { href: '/leave', label: 'Leave', icon: 'calendar', module: 'leave' },
  { href: '/payroll', label: 'Payroll', rupee: true, module: 'payroll' },
  { href: '/expense', label: 'Expense', icon: 'receipt', module: 'expenses' },
  { href: '/recruitment', label: 'Recruitment', icon: 'briefcase', module: 'recruitment' },
  { href: '/onboarding', label: 'Onboarding', icon: 'userplus', module: 'offboarding' },
  { href: '/performance', label: 'Performance', icon: 'trending', module: 'performance' },
  { href: '/assets', label: 'Asset', icon: 'laptop', module: 'assets' },
  { href: '/helpdesk', label: 'Helpdesk', icon: 'lifebuoy', module: 'helpdesk' },
  { href: '/lms', label: 'LMS', icon: 'book', module: 'lms' },
  { href: '/shifts', label: 'Shift & Roster', icon: 'clock', module: 'shift_roster' },
  { href: '/reports', label: 'Reports', icon: 'chart', module: 'reports' },
  { href: '/documents', label: 'Document', icon: 'file', module: 'documents' },
  { href: '/compliance', label: 'Compliance', icon: 'shieldcheck', module: 'statutory' },
  { href: '/integrations', label: 'Integrations', icon: 'plug', module: 'integrations' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export const EMPLOYEE_MENU: MenuItem[] = [
  { href: '/dashboard', label: 'My Dashboard', icon: 'grid' },
  { href: '/me/profile', label: 'My Profile', icon: 'user' },
  { href: '/me/attendance', label: 'My Attendance', icon: 'clock', module: 'attendance' },
  { href: '/me/leave', label: 'My Leave', icon: 'calendar', module: 'leave' },
  { href: '/me/payroll', label: 'My Payroll', rupee: true, module: 'payroll' },
  { href: '/me/tax', label: 'My Tax', icon: 'receipt', module: 'payroll' },
  { href: '/me/expenses', label: 'My Expenses', icon: 'receipt', module: 'expenses' },
  { href: '/me/assets', label: 'My Assets', icon: 'laptop', module: 'assets' },
  { href: '/me/documents', label: 'My Documents', icon: 'file', module: 'documents' },
  { href: '/me/team', label: 'My Team', icon: 'users', module: 'employee_core' },
  { href: '/helpdesk', label: 'Helpdesk', icon: 'lifebuoy', module: 'helpdesk' },
  { href: '/lms', label: 'LMS', icon: 'book', module: 'lms' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export type Viewer = {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  employeeId: string | null;
  isEmployer: boolean;
  /** Permission codes granted to this member's role in this organisation. */
  perms: string[];
  /** Mirrors app.can() — the owner's '*' grants everything. */
  can: (perm: string) => boolean;
};

/** Reads the caller's membership. The company is resolved after login, never chosen on the login page. */
export async function getViewer(): Promise<Viewer> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: member } = await supabase
    .from('org_members')
    .select('org_id, role, employee_id, organizations(name)')
    .eq('user_id', user?.id ?? '')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const role = (member as any)?.role ?? null;
  const orgId = (member as any)?.org_id ?? null;

  /* The same grants app.can() reads inside every RLS policy. Reading them here
     lets the portal hide an action the database would refuse anyway, which is
     the difference between a disabled button and a red error after ten minutes
     of typing. roleperm_select scopes this to the caller's own organisation. */
  let perms: string[] = [];
  if (orgId && role) {
    const { data: rows } = await supabase
      .from('org_role_permissions')
      .select('permission')
      .eq('org_id', orgId)
      .eq('role', role);
    perms = ((rows ?? []) as { permission: string }[]).map((r) => r.permission);
  }
  const permSet = new Set(perms);

  return {
    userId: user?.id ?? '',
    email: user?.email ?? '',
    orgId,
    orgName: (member as any)?.organizations?.name ?? null,
    role,
    employeeId: (member as any)?.employee_id ?? null,
    isEmployer: !!role && role !== 'employee',
    perms,
    can: (perm: string) => permSet.has('*') || permSet.has(perm),
  };
}

/**
 * The module codes this organisation's licence actually includes.
 *
 * A trial does not get everything. The platform sets organization_modules from
 * the plan when the customer is created, and the database already refuses
 * writes to a disabled module through app.require_module — but until now the
 * portal drew the whole catalogue in the sidebar regardless, so a trial
 * customer saw Payroll and Recruitment and found out they were unavailable only
 * by clicking.
 *
 * Reading this is safe from the customer side: orgmod_select lets a member read
 * their own organisation's rows and nobody else's.
 */
export async function getEnabledModules(orgId: string | null): Promise<Set<string>> {
  if (!orgId) return new Set<string>();
  const supabase = createClient();
  const { data } = await supabase
    .from('organization_modules')
    .select('module_code')
    .eq('org_id', orgId)
    .eq('enabled', true);
  return new Set(((data ?? []) as { module_code: string }[]).map((r) => r.module_code));
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  finance_approver: 'Finance',
  manager: 'Manager',
  recruiter: 'Recruiter',
  auditor: 'Auditor',
  employee: 'Employee',
};

export async function CustomerShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  const v = await getViewer();
  const employer = v.isEmployer;

  const all = employer ? EMPLOYER_MENU : EMPLOYEE_MENU;
  const enabled = await getEnabledModules(v.orgId);
  const menu = all.filter((m) => !m.module || enabled.has(m.module));

  /* Hiding the link is not enough — the address bar still works. If this page
     belongs to a module the licence does not include, the shell renders in
     place of the page rather than around it. */
  const needed = all.find((m) => m.href === current)?.module;
  const locked = Boolean(needed) && !enabled.has(needed as string);

  return (
    <Shell
      host="apps.humanest.co.in"
      brandSub={employer ? 'Employer Portal' : 'Self Service'}
      roleLabel={employer ? 'Employer' : 'Employee'}
      userName={v.orgName ?? v.email ?? 'Signed in'}
      userMeta={v.role ? ROLE_LABEL[v.role] ?? v.role : v.email}
      menu={menu}
      current={current}
      upsell={
        employer
          ? {
              title: 'Upgrade to Enterprise',
              body: 'All modules, a white-label domain and a dedicated success manager.',
              cta: 'See plans',
            }
          : undefined
      }
    >
      {v.orgId ? null : (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>This account is not a member of any organisation yet.</b> Add a row to{' '}
            <code>org_members</code> linking this user to an organisation and a role. Until then
            every list stays empty, because row level security is doing its job.
          </span>
        </div>
      )}
      {locked ? <ModuleLocked /> : children}
    </Shell>
  );
}

/** Shown where a page would be when the organisation's plan does not include it. */
function ModuleLocked() {
  return (
    <EmptyState
      icon="lock"
      title="This module is not part of your current plan"
      body="Ask your account owner to add it, or talk to HumaNest about upgrading. Nothing is lost — the moment the module is enabled, this section appears with your data in it."
    />
  );
}

/** The prompt requires this banner wherever an employee sees their own payroll or records. */
export function EssBanner() {
  return (
    <div className="mb-4 flex gap-2.5 rounded-xl bg-brand-soft px-3.5 py-3 text-[13px] leading-relaxed text-brand-dark">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <span>
        <b>ESS isolated &mdash; only your data is visible.</b> Other employees&rsquo; records are
        blocked from this portal by row level security, not just hidden from the menu.
      </span>
    </div>
  );
}
