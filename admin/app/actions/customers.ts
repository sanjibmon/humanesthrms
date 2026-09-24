'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole, customerInviteRedirectTo } from '@/lib/supabase/admin';
import { requirePlatform, PermissionError } from '@/lib/guard';
import { ok, fail, friendly, str, nullIfBlank, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

function boom(e: unknown): ActionResult {
  if (e instanceof PermissionError) return fail(e.message);
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/customers');
  revalidatePath('/trials');
  revalidatePath('/licenses');
  revalidatePath('/dashboard');
};

/* ------------------------------------------------------------------ create */

export async function createCustomer(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();

    const status = str(v.status) || 'trial';
    const ownerRole = str(v.owner_role) || 'owner';

    /* Checked before the organisation is created, not after. Creating the
       company and then failing to invite its admin leaves a half-built customer
       that somebody has to clean up by hand. */
    if (str(v.owner_email).trim() === '') {
      return fail('Every account needs an admin user.', 'owner_email');
    }
    if (ADMIN_ROLES.includes(ownerRole) && str(v.owner_phone).trim() === '') {
      return fail('A contact number is required for the admin user.', 'owner_phone');
    }

    const { data, error } = await supabase.schema('api').rpc('create_customer', {
      p_name: str(v.name),
      p_slug: str(v.slug),
      p_plan: str(v.plan),
      p_seats: Number(v.seats) || 1,
      p_status: status,
      p_trial_days: Number(v.trial_days) || 14,
      p_legal_name: nullIfBlank(v.legal_name),
      p_industry: nullIfBlank(v.industry),
      p_pan: nullIfBlank(v.pan),
      p_tan: nullIfBlank(v.tan),
      p_gstin: nullIfBlank(v.gstin),
      p_billing_cycle: str(v.billing_cycle) || 'monthly',
    });

    if (error) {
      const msg = friendly(error);
      if (error.code === '23505') return fail('That short name is already taken.', 'slug');
      return fail(msg);
    }

    const orgId = String(data);
    const ownerEmail = str(v.owner_email);
    let note = '';

    if (ownerEmail) {
      const invited = await inviteOrgOwner(orgId, ownerEmail, ownerRole, str(v.owner_phone));
      note = invited.ok ? ' ' + (invited.message ?? '') : ' ' + invited.error;
    }

    touch();
    return ok(`${str(v.name)} created.${note}`, { id: orgId });
  } catch (e) {
    return boom(e);
  }
}

/* ---------------------------------------------------------------- owner */

/**
 * Creates (or reuses) the auth user, emails them an invitation, then seeds the
 * first org_members row through api.provision_org_owner — the one write no RLS
 * policy can allow, because members.manage requires an existing member.
 */
/** Roles that administer a customer account, and therefore must be reachable. */
const ADMIN_ROLES = ['owner', 'hr_admin', 'payroll_admin'];

export async function inviteOrgOwner(
  orgId: string,
  email: string,
  role = 'owner',
  phone = '',
): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');

    /* The database refuses an administrator with no number, but a Postgres
       error is a poor way to learn that — catch it while the form is still
       open and the field can be pointed at. */
    if (ADMIN_ROLES.includes(role) && phone.trim() === '') {
      return fail('A contact number is required for an administrator.', 'phone');
    }

    if (!hasServiceRole()) {
      return fail(
        'Invitations need SUPABASE_SERVICE_ROLE_KEY in the environment. The customer was saved; add the key and invite from the customer page.',
      );
    }

    const admin = createAdminClient();
    const lower = email.toLowerCase();

    let userId: string | null = null;
    let sent: 'invite' | 'reset' | 'none' = 'invite';

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(lower, {
      // The customer portal, not this one — see customerInviteRedirectTo().
      redirectTo: customerInviteRedirectTo(),
      data: { org_id: orgId, invited_as: role },
    });

    if (inviteErr) {
      // Already registered is not a failure — link the existing account instead.
      const already = /already been registered|already exists/i.test(inviteErr.message);
      if (!already) return fail(`Could not send the invitation: ${inviteErr.message}`);

      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = list.users.find((u) => (u.email ?? '').toLowerCase() === lower)?.id ?? null;
      if (!userId) {
        return fail('That email already has an account, but it could not be found to link.');
      }

      /* Supabase will not re-issue an invitation to an address it already knows,
         and says so with a 422 — which used to be swallowed here, so the portal
         reported "Invitation sent" while nothing left the mail server. Send the
         one email that *is* allowed for an existing account instead: a password
         reset, which lands on the same /auth/callback page. */
      const { error: resetErr } = await createClient().auth.resetPasswordForEmail(lower, {
        redirectTo: customerInviteRedirectTo(),
      });
      sent = resetErr ? 'none' : 'reset';
    } else {
      userId = invited.user?.id ?? null;
    }

    if (!userId) return fail('The invitation went out but no user id came back.');

    const supabase = createClient();
    const { error } = await supabase.schema('api').rpc('provision_org_owner', {
      p_org: orgId,
      p_user: userId,
      p_role: role,
      p_phone: phone.trim() || null,
    });
    if (error) return fail(friendly(error));

    revalidatePath(`/customers/${orgId}`);
    return ok(
      sent === 'invite'
        ? `Invitation sent to ${lower}.`
        : sent === 'reset'
          ? `${lower} already had an account, so it was linked to this organisation and a password-reset email was sent instead of an invitation.`
          : `${lower} already had an account and was linked to this organisation, but no email could be sent. Delete the account and invite again for a fresh invitation.`,
    );
  } catch (e) {
    return boom(e);
  }
}

export async function inviteOrgOwnerAction(v: Values): Promise<ActionResult> {
  return inviteOrgOwner(str(v.org_id), str(v.email), str(v.role) || 'owner', str(v.phone));
}

/**
 * Correct a number that was mistyped. A mandatory field with no edit path is a
 * trap — one wrong digit and nobody can reach that customer again.
 */
export async function setOrgMemberPhone(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const { data, error } = await supabase
      .schema('api')
      .rpc('set_org_member_phone', { p_member: str(v.id), p_phone: str(v.phone) });
    if (error) return fail(friendly(error), 'phone');
    revalidatePath(`/customers/${str(v.org_id)}`);
    return ok(`Contact number saved as ${String(data)}.`);
  } catch (e) {
    return boom(e);
  }
}

export async function setMemberActive(memberId: string, active: boolean): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const { error } = await supabase.schema('api').rpc('set_org_member_active', {
      p_member: memberId,
      p_active: active,
    });
    if (error) return fail(friendly(error));
    revalidatePath('/customers');
    return ok(active ? 'Member reactivated.' : 'Member deactivated.');
  } catch (e) {
    return boom(e);
  }
}

/**
 * Permanent removal. Deactivation hides someone; this erases them.
 *
 * Two halves that must both happen, because org_members.user_id has no foreign
 * key to auth.users:
 *
 *   1. api.purge_org_member clears the tenant-side rows and reports whether the
 *      person still belongs to another organisation.
 *   2. If they do not, the sign-in itself is destroyed with the service role,
 *      which cascades sessions, identities, authenticator factors and any
 *      outstanding invitation tokens.
 *
 * Doing only the second half is what left an orphan membership row pointing at
 * a user id that no longer exists. Doing only the first leaves an account that
 * can still sign in — and that cannot be re-invited, because the address is
 * taken.
 */
export async function deleteOrgMember(memberId: string, orgId: string): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();

    const { data, error } = await supabase
      .schema('api')
      .rpc('purge_org_member', { p_member: memberId });
    if (error) return fail(friendly(error));

    const row = (Array.isArray(data) ? data[0] : data) as
      | { user_id: string; purge_auth: boolean }
      | undefined;

    let note = '';
    if (row?.purge_auth) {
      if (!hasServiceRole()) {
        note =
          ' Their organisation data is gone, but the sign-in itself survives until' +
          ' SUPABASE_SERVICE_ROLE_KEY is set.';
      } else {
        const { error: authErr } = await createAdminClient().auth.admin.deleteUser(row.user_id);
        // A missing user is the desired end state, not a failure.
        if (authErr && !/not found|does not exist/i.test(authErr.message)) {
          note = ` Their data is gone, but the sign-in could not be deleted: ${authErr.message}`;
        }
      }
    } else if (row) {
      note = ' Their sign-in was kept — they still belong to another organisation.';
    }

    revalidatePath(`/customers/${orgId}`);
    touch();
    return ok(`Removed permanently.${note}`);
  } catch (e) {
    return boom(e);
  }
}

/* ---------------------------------------------------------------- update */

export async function updateCustomer(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const id = str(v.id);

    const { error } = await supabase
      .from('organizations')
      .update({
        name: str(v.name),
        legal_name: nullIfBlank(v.legal_name),
        slug: str(v.slug),
        industry: nullIfBlank(v.industry),
        pan: nullIfBlank(v.pan),
        tan: nullIfBlank(v.tan),
        gstin: nullIfBlank(v.gstin),
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return fail('That short name is already taken.', 'slug');
      return fail(friendly(error));
    }
    touch();
    return ok('Customer updated.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------ lifecycle */

export async function setCustomerStatus(
  id: string,
  status: 'trial' | 'active' | 'suspended' | 'expired' | 'cancelled',
  reason?: string,
): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();

    const patch: Record<string, unknown> = { status, status_reason: reason ?? null };
    if (status === 'active') {
      patch.converted_at = new Date().toISOString();
      patch.trial_ends_at = null;
    }
    if (status === 'expired' || status === 'cancelled') {
      patch.non_conversion_reason = reason ?? null;
    }

    const { error } = await supabase.from('organizations').update(patch).eq('id', id);
    if (error) return fail(friendly(error));

    touch();
    const label: Record<string, string> = {
      trial: 'moved back to trial',
      active: 'activated',
      suspended: 'suspended — their people can no longer sign in',
      expired: 'marked expired',
      cancelled: 'cancelled',
    };
    return ok(`Customer ${label[status]}.`);
  } catch (e) {
    return boom(e);
  }
}

export async function extendTrial(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const id = str(v.id);
    const days = Number(v.days) || 7;

    const { data: org, error: readErr } = await supabase
      .from('organizations')
      .select('trial_ends_at, trial_extended_count, status')
      .eq('id', id)
      .maybeSingle();
    if (readErr) return fail(friendly(readErr));
    if (!org) return fail('That customer no longer exists.');

    const row = org as { trial_ends_at: string | null; trial_extended_count: number; status: string };
    const from = row.trial_ends_at ? new Date(row.trial_ends_at) : new Date();
    const base = from.getTime() > Date.now() ? from : new Date();
    const next = new Date(base.getTime() + days * 86400000);

    const { error } = await supabase
      .from('organizations')
      .update({
        trial_ends_at: next.toISOString(),
        trial_extended_count: (row.trial_extended_count ?? 0) + 1,
        status: 'trial',
        status_reason: nullIfBlank(v.reason),
      })
      .eq('id', id);
    if (error) return fail(friendly(error));

    touch();
    return ok(`Trial extended by ${days} days, to ${next.toLocaleDateString('en-IN')}.`);
  } catch (e) {
    return boom(e);
  }
}

export async function convertCustomer(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const id = str(v.id);

    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('id, name, max_seats')
      .eq('code', str(v.plan))
      .maybeSingle();
    if (planErr) return fail(friendly(planErr));
    if (!plan) return fail('That plan no longer exists.', 'plan');

    const p = plan as { id: string; name: string; max_seats: number | null };
    const seats = Number(v.seats) || 1;
    if (p.max_seats !== null && seats > p.max_seats) {
      return fail(`The ${p.name} plan allows at most ${p.max_seats} seats.`, 'seats');
    }

    const { error: licErr } = await supabase
      .from('organization_licenses')
      .update({
        plan_id: p.id,
        seats_total: seats,
        billing_cycle: str(v.billing_cycle) || 'monthly',
        next_billing_at: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      })
      .eq('org_id', id);
    if (licErr) return fail(friendly(licErr));

    const { error: orgErr } = await supabase
      .from('organizations')
      .update({ status: 'active', converted_at: new Date().toISOString(), trial_ends_at: null })
      .eq('id', id);
    if (orgErr) return fail(friendly(orgErr));

    const { error: syncErr } = await supabase.schema('api').rpc('sync_org_modules_to_plan', { p_org: id });
    if (syncErr) return fail(`Converted, but the module sync failed: ${friendly(syncErr)}`);

    touch();
    return ok(`Converted to ${p.name} with ${seats} seats. Modules re-synced to the plan.`);
  } catch (e) {
    return boom(e);
  }
}

/* ---------------------------------------------------------------- licence */

export async function updateLicense(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_licenses');
    const supabase = createClient();
    const id = str(v.org_id);

    const { data: plan } = await supabase
      .from('plans')
      .select('id, name, max_seats')
      .eq('code', str(v.plan))
      .maybeSingle();
    if (!plan) return fail('That plan no longer exists.', 'plan');
    const p = plan as { id: string; name: string; max_seats: number | null };

    const seats = Number(v.seats_total) || 1;
    if (p.max_seats !== null && seats > p.max_seats) {
      return fail(`The ${p.name} plan allows at most ${p.max_seats} seats.`, 'seats_total');
    }

    const custom = str(v.custom_price);
    const { error } = await supabase
      .from('organization_licenses')
      .update({
        plan_id: p.id,
        seats_total: seats,
        billing_cycle: str(v.billing_cycle) || 'monthly',
        block_over_allocation: v.block_over_allocation === true || v.block_over_allocation === 'true',
        grace_days: Number(v.grace_days) || 7,
        custom_price_per_seat_paise: custom === '' ? null : Math.round(Number(custom) * 100),
        next_billing_at: nullIfBlank(v.next_billing_at),
      })
      .eq('org_id', id);
    if (error) return fail(friendly(error));

    touch();
    return ok('Licence updated.');
  } catch (e) {
    return boom(e);
  }
}

export async function syncModulesToPlan(orgId: string): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const { error } = await supabase.schema('api').rpc('sync_org_modules_to_plan', { p_org: orgId });
    if (error) return fail(friendly(error));
    revalidatePath(`/customers/${orgId}`);
    return ok('Modules re-synced to the plan.');
  } catch (e) {
    return boom(e);
  }
}

export async function toggleOrgModule(
  orgId: string,
  moduleCode: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    await requirePlatform('edit_modules');
    const supabase = createClient();
    const { error } = await supabase
      .from('organization_modules')
      .upsert(
        { org_id: orgId, module_code: moduleCode, enabled, enabled_at: enabled ? new Date().toISOString() : null },
        { onConflict: 'org_id,module_code' },
      );
    if (error) return fail(friendly(error));
    revalidatePath(`/customers/${orgId}`);
    return ok(`${moduleCode.replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'}.`);
  } catch (e) {
    return boom(e);
  }
}

/* ---------------------------------------------------------------- delete */

export async function deleteCustomer(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_customers');
    const supabase = createClient();
    const { error } = await supabase.schema('api').rpc('delete_customer', {
      p_org: str(v.id),
      p_confirm_name: str(v.confirm_name),
    });
    if (error) return fail(friendly(error));
    touch();
    return ok('Customer and all of their data deleted.');
  } catch (e) {
    return boom(e);
  }
}
