import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { SettingsConsole, type Org, type Policy, type Caps } from '@/components/settings/settings-console';

export const dynamic = 'force-dynamic';

/**
 * The permission codes shown on the role grid. Taken from what the policies in
 * this database actually test for, grouped so the grid reads like the product
 * rather than like a dump of strings.
 */
const PERMISSIONS = [
  'people.read', 'people.write', 'people.sensitive.read', 'people.sensitive.write',
  'attendance.read', 'attendance.write', 'attendance.approve',
  'leave.read', 'leave.approve', 'leave.config',
  'payroll.read', 'payroll.config', 'payroll.run', 'payroll.approve', 'payroll.pay',
  'expenses.read', 'expenses.approve',
  'approvals.read',
  'recruitment.read', 'recruitment.write',
  'performance.read', 'performance.write', 'performance.admin',
  'offboarding.read', 'offboarding.manage',
  'assets.read', 'assets.manage',
  'helpdesk.read', 'helpdesk.manage',
  'documents.read',
  'compliance.read', 'compliance.file',
  'reports.read',
  'members.read', 'members.manage',
  'settings.read', 'settings.write',
  'audit.read', 'privacy.manage',
];

export default async function SettingsPage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  const [
    { data: orgRow }, { data: policy }, { data: entities }, { data: locations },
    { data: leaveTypes }, { data: holidays }, { data: shifts },
    { data: members }, { data: rolePerms }, { data: devices }, { data: events },
  ] = await Promise.all([
    supabase.from('organizations').select('id,name,legal_name,industry,pan,tan,gstin,timezone,status').eq('id', org).maybeSingle(),
    supabase.from('org_settings').select('*').eq('org_id', org).maybeSingle(),
    supabase.from('legal_entities').select('id,name,pan,tan,gstin,pf_code,esi_code,state_code,is_default').eq('org_id', org).order('name'),
    supabase.from('locations').select('id,name,city,state_code,address,geofence_radius_m,is_active').eq('org_id', org).order('name'),
    supabase.from('leave_types').select('*').eq('org_id', org).order('code'),
    supabase.from('holidays').select('id,holiday_date,name,is_optional,location_id').eq('org_id', org).order('holiday_date'),
    supabase.from('shifts').select('id,name,start_time,end_time,grace_minutes,half_day_minutes,full_day_minutes,is_default').eq('org_id', org).order('name'),
    supabase.schema('api').rpc('list_org_logins', { p_org: org }),
    supabase.from('org_role_permissions').select('role,permission').eq('org_id', org),
    supabase.from('trusted_devices').select('id,label,first_seen,last_seen,revoked_at').order('last_seen', { ascending: false }),
    supabase.from('security_events').select('id,event_type,ip,user_agent,created_at').order('created_at', { ascending: false }).limit(40),
  ]);

  /* One row per login, employer and employee alike. The join to auth.users --
     the email, when they were invited, when they activated, when they last
     signed in -- can only happen inside a security definer function, which is
     why this is an RPC rather than a select. Without activated_at the portal
     cannot tell somebody who never arrived from somebody who simply has not
     signed in today, and "resend activation" would be a guess. */
  const loginRows = (members ?? []) as any[];

  return (
    <CustomerShell current="/settings">
      <PageHead
        title="Settings"
        sub="Company, working policy, leave rules, access and security"
      />
      <SettingsConsole
        org={(orgRow ?? null) as Org}
        policy={(policy ?? null) as Policy}
        entities={(entities ?? []) as any[]}
        locations={(locations ?? []) as any[]}
        leaveTypes={(leaveTypes ?? []) as any[]}
        holidays={(holidays ?? []) as any[]}
        shifts={(shifts ?? []) as any[]}
        members={loginRows}
        rolePermissions={(rolePerms ?? []) as { role: string; permission: string }[]}
        permissionCodes={PERMISSIONS}
        devices={(devices ?? []) as any[]}
        events={(events ?? []) as any[]}
        caps={
          {
            settings: v.can('settings.write'),
            leave: v.can('leave.config'),
            attendance: v.can('attendance.write'),
            members: v.can('members.manage') || v.can('people.write'),
            audit: v.can('audit.read'),
          } satisfies Caps
        }
      />
    </CustomerShell>
  );
}
