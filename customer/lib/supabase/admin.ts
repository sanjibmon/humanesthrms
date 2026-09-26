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

/**
 * Checks that SUPABASE_SERVICE_ROLE_KEY really is a service-role key, and says
 * what is wrong when it is not.
 *
 * This exists because of the single most common misconfiguration in any Supabase
 * project: pasting the anon or publishable key into the service-role slot. Both
 * are on the same settings page, both are long opaque strings, and nothing
 * rejects the wrong one until an Auth admin call comes back 401 — which reads as
 * a vague "API error" and sends people hunting through their own code.
 *
 * A legacy key is a JWT whose payload carries the role, so it can be read
 * without verifying the signature: no secret is needed to see whether it claims
 * to be 'service_role' or 'anon'. A modern key is prefixed, so the prefix alone
 * settles it. Returns null when the key looks right.
 */
export function serviceRoleProblem(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !key.trim()) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Copy the service_role key from Supabase → Project Settings → API keys, and add it in Vercel → Settings → Environment Variables. It must NOT have a NEXT_PUBLIC_ prefix.';
  }
  const k = key.trim();

  if (k.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY holds a publishable key (it starts with sb_publishable_). That one is for the browser and cannot invite anybody. You need the secret key — it starts with sb_secret_ — from Supabase → Project Settings → API keys.';
  }
  if (k.startsWith('sb_secret_')) return null;

  /* A legacy JWT. Read the payload without verifying it: the role is public
     information inside the token, and knowing it does not require the secret. */
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
      const payload = JSON.parse(
        atob(pad.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { role?: string };
      if (payload.role === 'service_role') return null;
      if (payload.role) {
        return `SUPABASE_SERVICE_ROLE_KEY holds the "${payload.role}" key, not the service_role one. Those two sit next to each other in Supabase → Project Settings → API keys, and it is an easy copy to get wrong. Replace it with the key whose role is service_role.`;
      }
    } catch {
      /* Not decodable — fall through to the generic message rather than guess. */
    }
  }

  return 'SUPABASE_SERVICE_ROLE_KEY does not look like a Supabase secret key. It should be either a JWT whose role is service_role, or a key starting with sb_secret_. Copy it again from Supabase → Project Settings → API keys.';
}
