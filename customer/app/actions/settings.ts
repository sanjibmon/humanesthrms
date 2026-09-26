'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, boolOf, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';
import { createAdminClient, serviceRoleProblem, activationRedirectTo } from '@/lib/supabase/admin';

/**
 * Security & Admin.
 *
 * Note how unevenly the permissions are spread, because the database spreads
 * them that way and this file follows rather than flattens it:
 *
 *   settings.write   organisation policy, legal entities, locations
 *   leave.config     leave types and the holiday calendar
 *   attendance.write shifts
 *   members.manage   members and the role permission matrix — and this one is
 *                    can_mfa, so an authenticator-verified session is required
 *
 * Getting that wrong would mean a button that looks available and then fails,
 * which is worse than no button.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/settings');
  revalidatePath('/dashboard');
};

async function ctx(perm: string) {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) throw new Error(DENIED[perm] ?? 'Your role does not allow this.');
  return { v, supabase: createClient() };
}

const DENIED: Record<string, string> = {
  'settings.write': 'Your role cannot change organisation settings.',
  'leave.config': 'Your role cannot configure leave.',
  'attendance.write': 'Your role cannot configure shifts.',
  'members.manage': 'Only an owner or somebody with member management can change access.',
};

/* ------------------------------------------------------------ org policy */

export async function saveOrgPolicy(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('settings.write');

    const weekly = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      .map((d, i) => (boolOf(vals[`off_${d}`]) ? i : null))
      .filter((x): x is number => x !== null);

    const { error } = await supabase.from('org_settings').upsert(
      {
        org_id: v.orgId,
        weekly_offs: weekly,
        leave_year_start_month: numOrNull(vals.leave_year_start_month) ?? 4,
        default_probation_days: Math.min(730, Math.max(1, numOrNull(vals.default_probation_days) ?? 180)),
        selfie_mandatory: boolOf(vals.selfie_mandatory),
        geofence_mandatory: boolOf(vals.geofence_mandatory),
        allow_wfh: boolOf(vals.allow_wfh),
        reject_mock_location: boolOf(vals.reject_mock_location),
        ip_restriction: boolOf(vals.ip_restriction),
        wage_definition: str(vals.wage_definition) || 'labour_code',
        esi_includes_overtime: boolOf(vals.esi_includes_overtime),
        payroll_day_basis: str(vals.payroll_day_basis) || 'calendar',
        payroll_maker_checker: boolOf(vals.payroll_maker_checker),
        pf_on_actual_default: boolOf(vals.pf_on_actual_default),
      },
      { onConflict: 'org_id' },
    );
    if (error) return fail(friendly(error));

    touch();
    return ok('Policy saved. It applies to attendance and payroll from now on.');
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------- company profile */

export async function saveCompanyProfile(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('settings.write');
    /* protect_org_columns stops a customer editing their own status, plan or
       trial dates from here — only name, address and the statutory numbers. */
    const { error } = await supabase
      .from('organizations')
      .update({
        name: str(vals.name),
        legal_name: nullIfBlank(vals.legal_name),
        industry: nullIfBlank(vals.industry),
        pan: nullIfBlank(str(vals.pan).toUpperCase()),
        tan: nullIfBlank(str(vals.tan).toUpperCase()),
        gstin: nullIfBlank(str(vals.gstin).toUpperCase()),
        timezone: str(vals.timezone) || 'Asia/Kolkata',
      })
      .eq('id', v.orgId);
    if (error) return fail(friendly(error));
    touch();
    return ok('Company details saved.');
  } catch (e) {
    return boom(e);
  }
}

/* -------------------------------------------------------- legal entities */

export async function saveLegalEntity(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('settings.write');
    const row = {
      org_id: v.orgId,
      name: str(vals.name),
      pan: nullIfBlank(str(vals.pan).toUpperCase()),
      tan: nullIfBlank(str(vals.tan).toUpperCase()),
      gstin: nullIfBlank(str(vals.gstin).toUpperCase()),
      pf_code: nullIfBlank(vals.pf_code),
      esi_code: nullIfBlank(vals.esi_code),
      state_code: nullIfBlank(str(vals.state_code).toUpperCase()),
      is_default: boolOf(vals.is_default),
    };
    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('legal_entities').update(row).eq('id', id)
      : await supabase.from('legal_entities').insert(row);
    if (error) return fail(friendly(error));
    touch();
    return ok(id ? 'Entity updated.' : 'Entity added.');
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------------- locations */

export async function saveLocation(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('settings.write');
    const state = str(vals.state_code).toUpperCase();
    if (!state) return fail('State decides professional tax and LWF.', 'state_code');

    const row = {
      org_id: v.orgId,
      name: str(vals.name),
      city: nullIfBlank(vals.city),
      state_code: state,
      address: nullIfBlank(vals.address),
      geofence_radius_m: numOrNull(vals.geofence_radius_m) ?? 100,
      is_active: vals.is_active === undefined ? true : boolOf(vals.is_active),
    };
    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('locations').update(row).eq('id', id)
      : await supabase.from('locations').insert(row);
    if (error) return fail(friendly(error));
    touch();
    return ok(id ? 'Location updated.' : 'Location added.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------ leave types */

export async function saveLeaveType(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const row = {
      org_id: v.orgId,
      code: str(vals.code).toUpperCase(),
      name: str(vals.name),
      is_paid: boolOf(vals.is_paid),
      days_per_year: numOrNull(vals.days_per_year),
      accrual: str(vals.accrual) || 'annual',
      carry_forward: boolOf(vals.carry_forward),
      carry_max: numOrNull(vals.carry_max),
      half_day_allowed: boolOf(vals.half_day_allowed),
      probation_days: numOrNull(vals.probation_days) ?? 0,
      doc_required_after_days: numOrNull(vals.doc_required_after_days),
      approval_levels: numOrNull(vals.approval_levels) ?? 1,
      dept_head_after_days: numOrNull(vals.dept_head_after_days),
      auto_approve: boolOf(vals.auto_approve),
      allow_negative: boolOf(vals.allow_negative),
      is_active: vals.is_active === undefined ? true : boolOf(vals.is_active),
    };
    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('leave_types').update(row).eq('id', id)
      : await supabase.from('leave_types').insert(row);
    if (error) {
      if (error.code === '23505') return fail('That code is already used by another leave type.', 'code');
      return fail(friendly(error));
    }
    touch();
    revalidatePath('/me/leave');
    return ok(id ? 'Leave type updated.' : 'Leave type added.');
  } catch (e) {
    return boom(e);
  }
}

export async function saveHoliday(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const { error } = await supabase.from('holidays').insert({
      org_id: v.orgId,
      holiday_date: str(vals.holiday_date),
      name: str(vals.name),
      is_optional: boolOf(vals.is_optional),
      location_id: nullIfBlank(vals.location_id),
    });
    if (error) return fail(friendly(error));
    touch();
    return ok('Holiday added. It is excluded from leave day counts automatically.');
  } catch (e) {
    return boom(e);
  }
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('leave.config');
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Holiday removed.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------------ shifts */

export async function saveShift(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('attendance.write');
    const row = {
      org_id: v.orgId,
      name: str(vals.name),
      start_time: str(vals.start_time),
      end_time: str(vals.end_time),
      grace_minutes: numOrNull(vals.grace_minutes) ?? 10,
      half_day_minutes: numOrNull(vals.half_day_minutes) ?? 240,
      full_day_minutes: numOrNull(vals.full_day_minutes) ?? 480,
      is_default: boolOf(vals.is_default),
    };
    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('shifts').update(row).eq('id', id)
      : await supabase.from('shifts').insert(row);
    if (error) return fail(friendly(error));
    touch();
    return ok(id ? 'Shift updated.' : 'Shift added.');
  } catch (e) {
    return boom(e);
  }
}

/* -------------------------------------------------------- people and roles */

/* ------------------------------------------------------------ the people */

/**
 * Changes an employer user's role.
 *
 * The owner and HR Admin may both do this — the product owner's decision. Two
 * guards make the obvious abuses impossible rather than merely unlikely, and
 * both live in the database so they hold whatever calls them: nobody changes
 * their own role, and the last active owner cannot be demoted. Without the
 * first, "HR may change roles" would quietly mean "HR may become the owner".
 */
export async function setMemberRole(vals: Values): Promise<ActionResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.schema('api').rpc('set_member_role', {
      p_member: str(vals.id),
      p_role: str(vals.role),
    });
    if (error) return fail(memberMessage(error));

    const r = (data ?? {}) as { status?: string; from?: string; to?: string };
    touch();
    if (r.status === 'unchanged') return ok('That is already their role.');
    return ok(`Role changed from ${label(r.from)} to ${label(r.to)}. It applies to their next request.`);
  } catch (e) {
    return boom(e);
  }
}

/** Disable or enable a login. Nothing is deleted; access simply stops. */
export async function setMemberEnabled(vals: Values): Promise<ActionResult> {
  try {
    const enabled = boolOf(vals.enabled);
    const supabase = createClient();
    const { error } = await supabase.schema('api').rpc('set_member_enabled', {
      p_member: str(vals.id),
      p_enabled: enabled,
    });
    if (error) return fail(memberMessage(error));

    touch();
    return ok(
      enabled
        ? 'Enabled. They can sign in again with the password and authenticator they already had.'
        : 'Disabled. They cannot sign in, and every page refuses them until you enable it again. Nothing has been deleted.',
    );
  } catch (e) {
    return boom(e);
  }
}

/** A contact number, which every administrator role is required to have. */
export async function setMemberPhone(vals: Values): Promise<ActionResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.schema('api').rpc('set_member_phone', {
      p_member: str(vals.id),
      p_phone: str(vals.phone),
    });
    if (error) return fail(memberMessage(error));
    touch();
    return ok(`Contact number saved as ${(data as { phone?: string })?.phone ?? str(vals.phone)}.`);
  } catch (e) {
    return boom(e);
  }
}

/**
 * Sends the activation email again.
 *
 * Which email depends on where they got to. If they never set a password, the
 * original invitation is still the right thing and is simply reissued. If they
 * did, a fresh invitation would fail — the address already has an account — so
 * they get a set-password link instead. Saying which one went out matters,
 * because "resend" means different things to somebody who never arrived and
 * somebody who forgot their password.
 */
export async function resendActivation(memberId: string): Promise<ActionResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .schema('api')
      .rpc('member_activation_state', { p_member: str(memberId) });
    if (error) return fail(memberMessage(error));

    const st = (data ?? {}) as {
      email?: string | null;
      activated?: boolean;
      is_active?: boolean;
    };
    if (!st.email) {
      return fail('That login has no email address on record, so there is nowhere to send it.');
    }
    if (st.is_active === false) {
      return fail('That login is disabled. Enable it first — otherwise they activate an account that cannot sign in.');
    }

    const problem = serviceRoleProblem();
    if (problem) return fail(problem);

    const admin = createAdminClient();
    const email = st.email.toLowerCase();

    if (!st.activated) {
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: activationRedirectTo(),
      });
      if (inviteErr) return fail(authMessage(inviteErr));
      touch();
      return ok(`Invitation sent again to ${email}. The earlier link stops working.`);
    }

    const { error: resetErr } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: activationRedirectTo(),
    });
    if (resetErr) return fail(authMessage(resetErr));
    touch();
    return ok(
      `${email} already activated their account, so a set-password link has gone out instead of an invitation.`,
    );
  } catch (e) {
    return boom(e);
  }
}

const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  finance_approver: 'Finance Approver',
  manager: 'Manager',
  recruiter: 'Recruiter',
  auditor: 'Auditor',
  employee: 'Employee',
};
const label = (r?: string) => (r ? ROLE_WORDS[r] ?? r.replace(/_/g, ' ') : 'their role');

/** The prefixed exceptions the member functions raise, turned into English. */
function memberMessage(e: { message?: string; code?: string }): string {
  const m = e.message ?? '';
  if (m.startsWith('SELF_ROLE')) {
    return 'You cannot change your own role. Ask another owner or HR admin to do it — this is what stops anybody quietly promoting themselves.';
  }
  if (m.startsWith('SELF_DISABLE')) return 'You cannot disable your own login.';
  if (m.startsWith('LAST_OWNER')) {
    return 'This is the only owner. Make somebody else an owner first, or the organisation would be left with nobody who can administer it.';
  }
  if (m.startsWith('NO_EMPLOYEE')) {
    return 'The employee role is for self service only, so it needs an employee record behind it. Link this login to an employee first, from the Employees page.';
  }
  if (m.startsWith('NEEDS_PHONE')) {
    return 'An administrator has to have a contact number. Add one for this person first, then change the role.';
  }
  if (m.startsWith('BAD_PHONE') || /org_members_phone_check/.test(m)) {
    return 'Enter the number in international form, for example +919876543210.';
  }
  if (m.startsWith('BAD_ROLE')) return 'That is not a role this product has.';
  return friendly(e);
}

function authMessage(e: { message?: string; status?: number }): string {
  const m = e.message ?? '';
  if ((e.status ?? 0) === 401 || /invalid api key|unauthor/i.test(m)) {
    return 'Supabase refused the request with 401, which means SUPABASE_SERVICE_ROLE_KEY is not a service-role key on this deployment.';
  }
  if (/sending.*email|smtp|rate limit/i.test(m)) {
    return 'Supabase could not send the email. Either no SMTP sender is configured, or the built-in one has hit its limit of a couple of emails an hour.';
  }
  return `The email could not be sent. Supabase said: ${m || 'no reason given'}.`;
}

export async function setRolePermission(
  role: string,
  permission: string,
  grant: boolean,
): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('members.manage');
    if (role === 'owner') {
      return fail('The owner role holds every permission and cannot be narrowed.');
    }

    const { error } = grant
      ? await supabase
          .from('org_role_permissions')
          .upsert({ org_id: v.orgId, role, permission }, { onConflict: 'org_id,role,permission' })
      : await supabase
          .from('org_role_permissions')
          .delete()
          .eq('org_id', v.orgId)
          .eq('role', role)
          .eq('permission', permission);
    if (error) return fail(friendly(error));

    touch();
    return ok(`${grant ? 'Granted' : 'Revoked'} ${permission} for ${role.replace(/_/g, ' ')}.`);
  } catch (e) {
    return boom(e);
  }
}

/* ---------------------------------------------------------------- security */

/** Revokes one of the caller's own trusted devices. devices_own scopes it. */
export async function revokeTrustedDevice(id: string): Promise<ActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('trusted_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Device revoked. It will be challenged again next time.');
  } catch (e) {
    return boom(e);
  }
}
