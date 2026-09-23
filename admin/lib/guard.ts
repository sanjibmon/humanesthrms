import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type PlatformPermission =
  | 'manage_customers'
  | 'manage_licenses'
  | 'edit_modules'
  | 'manage_platform_users'
  | 'manage_statutory_rules'
  | 'support_access'
  | 'view_audit_logs'
  | 'view_revenue';

export type PlatformIdentity = {
  userId: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'support' | 'sales' | 'finance';
  permissions: PlatformPermission[];
};

/**
 * Resolves the caller's platform identity and permissions, and confirms the
 * session has reached AAL2. Row level security enforces all of this again at the
 * database, so this is a second gate rather than the only one — but it lets the
 * UI fail with a sentence instead of an empty result set.
 */
export async function getPlatformIdentity(): Promise<PlatformIdentity | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase
    .from('platform_users')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!me || !(me as { is_active: boolean }).is_active) return null;
  const row = me as { id: string; email: string; full_name: string; role: PlatformIdentity['role'] };

  const { data: perms } = await supabase
    .from('platform_role_permissions')
    .select('permission')
    .eq('role', row.role);

  return {
    userId: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    permissions: ((perms ?? []) as { permission: PlatformPermission }[]).map((p) => p.permission),
  };
}

export class PermissionError extends Error {}

/** Throws a message the action layer turns into a form error. */
export async function requirePlatform(perm: PlatformPermission): Promise<PlatformIdentity> {
  const me = await getPlatformIdentity();
  if (!me) {
    throw new PermissionError(
      'This account is not an active HumaNest platform user, or the authenticator step is not complete.',
    );
  }
  if (!me.permissions.includes(perm)) {
    throw new PermissionError(
      `Your role (${me.role.replace('_', ' ')}) does not include the ${perm.replace(/_/g, ' ')} permission.`,
    );
  }
  return me;
}

export const can = (me: PlatformIdentity | null, perm: PlatformPermission) =>
  Boolean(me?.permissions.includes(perm));
