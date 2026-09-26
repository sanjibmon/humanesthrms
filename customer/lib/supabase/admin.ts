import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. This key bypasses row level security entirely, so it
 * exists for exactly two jobs:
 *
 *   1. Supabase Auth admin calls (inviting users, creating accounts), which the
 *      anon key is not allowed to make.
 *   2. Seeding the very first member of an organisation, which no RLS policy can
 *      permit without a chicken-and-egg (org_members.members_write requires an
 *      existing member of that same organisation).
 *
 * Every caller must first prove the signed-in user is an active platform user
 * with the right permission — use requirePlatform() from lib/guard.ts. The key
 * is never imported into a client component; "server-only" makes that a build
 * error rather than a silent leak.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → Environment Variables.',
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const hasServiceRole = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const origin = (base: string | undefined) =>
  (
    base ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  ).replace(/\/$/, '');

/**
 * Where a HumaNest staff member lands after accepting an invitation — this
 * portal.
 */
export function inviteRedirectTo(): string {
  return `${origin(process.env.NEXT_PUBLIC_SITE_URL)}/auth/callback`;
}

/**
 * Where a *customer's* user lands. This is deliberately not the same origin:
 * an employer or HR admin belongs in the customer portal, not in the platform
 * admin portal. Sending them to NEXT_PUBLIC_SITE_URL drops them on a site they
 * have no account on, with no way to set a password.
 */
export function customerInviteRedirectTo(): string {
  return `${origin(
    process.env.NEXT_PUBLIC_CUSTOMER_PORTAL_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
  )}/auth/callback`;
}

/**
 * Where an employee lands after clicking Activate in their invitation email.
 *
 * This is the customer portal's own origin. The employee has no account on the
 * platform admin site, so sending them there would drop them on a sign-in page
 * they can never get past — which is exactly the bug the two separate helpers
 * above exist to prevent.
 */
export function activationRedirectTo(): string {
  return `${origin(process.env.NEXT_PUBLIC_SITE_URL)}/auth/callback`;
}
