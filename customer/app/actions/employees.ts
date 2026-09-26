'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole, activationRedirectTo } from '@/lib/supabase/admin';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, boolOf, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

/**
 * The employee master.
 *
 * Everything here runs as the signed-in user, never with the service role, so
 * row level security is the real authority: employees_write and personal_write
 * demand 'people.write', and statutory_write demands 'people.sensitive.write'
 * *plus* an AAL2 session. The permission checks below exist to produce a decent
 * message, not to provide the security — remove them and the database still
 * refuses.
 *
 * The record spans three tables on purpose, because they are not equally
 * sensitive:
 *
 *   employees           the directory. Any colleague may read it.
 *   employee_personal   date of birth, address, emergency contacts.
 *   employee_statutory  PAN, bank account, UAN. Encrypted at rest, written only
 *                       through api.save_statutory, read back only through
 *                       api.reveal_statutory, and every reveal is audited.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = (id?: string) => {
  revalidatePath('/employees');
  if (id) revalidatePath(`/employees/${id}`);
  revalidatePath('/dashboard');
};

async function ctx(perm = 'people.write') {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) {
    throw new Error(
      perm === 'people.sensitive.write'
        ? 'Your role cannot edit statutory and bank details.'
        : perm === 'payroll.config'
          ? 'Compensation is a payroll permission. Ask a payroll admin or the owner.'
          : perm === 'settings.write'
            ? 'Your role cannot change organisation settings.'
            : 'Your role cannot add or change employee records.',
    );
  }
  return { v, supabase: createClient() };
}

/* ------------------------------------------------------------------- codes */

/**
 * Next employee code, following whatever prefix the organisation already uses.
 * Looked up rather than counted, because a deleted record must not hand its
 * number to somebody else — employee codes end up on payslips and PF filings.
 */
export async function suggestEmployeeCode(): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const { data } = await supabase
      .from('employees')
      .select('employee_code')
      .eq('org_id', v.orgId)
      .order('employee_code', { ascending: false })
      .limit(200);

    const codes = ((data ?? []) as { employee_code: string }[]).map((r) => r.employee_code);
    const m = codes
      .map((c) => /^([A-Za-z-]*)(\d+)$/.exec(c))
      .filter(Boolean) as RegExpExecArray[];

    if (m.length === 0) return ok(undefined, { data: 'EMP001' });

    const prefix = m[0][1] || 'EMP';
    const width = m[0][2].length;
    const next = Math.max(...m.filter((x) => (x[1] || 'EMP') === prefix).map((x) => Number(x[2]))) + 1;
    return ok(undefined, { data: `${prefix}${String(next).padStart(width, '0')}` });
  } catch (e) {
    return boom(e);
  }
}

/**
 * Probation is always expressed in days, never months. "Six months from the
 * 31st of August" is a question with three defensible answers, and payroll
 * cannot afford an argument about which one applied. 180 days is the usual
 * Indian default and is what the organisation setting ships with.
 */
function probationDays(vals: Values, employmentType: string): { days: number | null; error?: ActionResult } {
  if (employmentType !== 'probation') return { days: null };
  const days = numOrNull(vals.probation_days);
  if (days === null || !Number.isInteger(days) || days < 1) {
    return { days: null, error: fail('How many days is the probation?', 'probation_days') };
  }
  if (days > 730) {
    return { days: null, error: fail('That is more than two years. Check the figure.', 'probation_days') };
  }
  return { days };
}

/* ------------------------------------------------------------------ create */

export async function createEmployee(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();

    const employmentType = str(vals.employment_type) || 'permanent';
    if (employmentType === 'fixed_term' && !str(vals.contract_end_date)) {
      return fail('A fixed-term employee needs a contract end date.', 'contract_end_date');
    }
    const prob = probationDays(vals, employmentType);
    if (prob.error) return prob.error;

    const { data, error } = await supabase
      .from('employees')
      .insert({
        org_id: v.orgId,
        employee_code: str(vals.employee_code),
        full_name: str(vals.full_name),
        // employees_work_email_check insists on lower case.
        work_email: nullIfBlank(str(vals.work_email).toLowerCase()),
        work_phone: nullIfBlank(vals.work_phone),
        doj: str(vals.doj),
        status: str(vals.status) || 'onboarding',
        employment_type: employmentType,
        probation_days: prob.days,
        contract_end_date: nullIfBlank(vals.contract_end_date),
        department_id: nullIfBlank(vals.department_id),
        designation_id: nullIfBlank(vals.designation_id),
        location_id: nullIfBlank(vals.location_id),
        entity_id: nullIfBlank(vals.entity_id),
        reporting_manager_id: nullIfBlank(vals.reporting_manager_id),
        created_by: v.userId,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') return fail('That employee code is already in use.', 'employee_code');
      return fail(friendly(error));
    }

    const id = (data as { id: string }).id;

    /* Personal details go in the same submission, so the record is complete
       from the first save rather than leaving a half-filled profile behind. */
    const personal = {
      employee_id: id,
      org_id: v.orgId,
      dob: nullIfBlank(vals.dob),
      gender: nullIfBlank(vals.gender),
      marital_status: nullIfBlank(vals.marital_status),
      blood_group: nullIfBlank(vals.blood_group),
      personal_email: nullIfBlank(str(vals.personal_email).toLowerCase()),
      personal_phone: nullIfBlank(vals.personal_phone),
      nationality: str(vals.nationality) || 'Indian',
      current_address: addressOf(vals, 'cur'),
      permanent_address: boolOf(vals.same_address) ? addressOf(vals, 'cur') : addressOf(vals, 'per'),
      emergency_contacts: emergencyOf(vals),
    };
    const { error: pErr } = await supabase.from('employee_personal').insert(personal);
    // The directory row is the important one; a personal-details failure is
    // reported but does not roll the employee back, because it is editable.
    const note = pErr ? ` Personal details could not be saved: ${friendly(pErr)}` : '';

    touch(id);
    return ok(`${str(vals.full_name)} added.${note}`, { id });
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------------ update */

export async function updateEmployeeJob(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const id = str(vals.id);

    const employmentType = str(vals.employment_type) || 'permanent';
    if (employmentType === 'fixed_term' && !str(vals.contract_end_date)) {
      return fail('A fixed-term employee needs a contract end date.', 'contract_end_date');
    }
    if (str(vals.reporting_manager_id) === id) {
      return fail('Somebody cannot report to themselves.', 'reporting_manager_id');
    }
    const prob = probationDays(vals, employmentType);
    if (prob.error) return prob.error;

    const { error } = await supabase
      .from('employees')
      .update({
        full_name: str(vals.full_name),
        work_email: nullIfBlank(str(vals.work_email).toLowerCase()),
        work_phone: nullIfBlank(vals.work_phone),
        doj: str(vals.doj),
        employment_type: employmentType,
        probation_days: prob.days,
        contract_end_date: nullIfBlank(vals.contract_end_date),
        department_id: nullIfBlank(vals.department_id),
        designation_id: nullIfBlank(vals.designation_id),
        location_id: nullIfBlank(vals.location_id),
        entity_id: nullIfBlank(vals.entity_id),
        reporting_manager_id: nullIfBlank(vals.reporting_manager_id),
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return fail('That employee code is already in use.', 'employee_code');
      return fail(friendly(error));
    }
    touch(id);
    return ok('Job details saved.');
  } catch (e) {
    return boom(e);
  }
}

export async function updateEmployeePersonal(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const id = str(vals.id);

    const row = {
      employee_id: id,
      org_id: v.orgId,
      dob: nullIfBlank(vals.dob),
      gender: nullIfBlank(vals.gender),
      marital_status: nullIfBlank(vals.marital_status),
      blood_group: nullIfBlank(vals.blood_group),
      personal_email: nullIfBlank(str(vals.personal_email).toLowerCase()),
      personal_phone: nullIfBlank(vals.personal_phone),
      nationality: str(vals.nationality) || 'Indian',
      current_address: addressOf(vals, 'cur'),
      permanent_address: boolOf(vals.same_address) ? addressOf(vals, 'cur') : addressOf(vals, 'per'),
      emergency_contacts: emergencyOf(vals),
    };

    // upsert, because an employee created before this form existed has no row.
    const { error } = await supabase
      .from('employee_personal')
      .upsert(row, { onConflict: 'employee_id' });
    if (error) return fail(friendly(error));

    touch(id);
    return ok('Personal details saved.');
  } catch (e) {
    return boom(e);
  }
}

/**
 * PAN and the bank account are encrypted by the database, never by us, and the
 * plaintext is never stored in a column. api.save_statutory does the encryption
 * and keeps only the last four digits in the clear for reconciliation.
 */
export async function updateEmployeeStatutory(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('people.sensitive.write');
    const id = str(vals.id);

    const pan = str(vals.pan).toUpperCase();
    const ifsc = str(vals.ifsc).toUpperCase();
    const aadhaar = str(vals.aadhaar_last4);
    const uan = str(vals.uan);
    const esi = str(vals.esi_ip_number);

    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return fail('PAN looks like ABCDE1234F.', 'pan');
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return fail('IFSC looks like HDFC0001234.', 'ifsc');
    if (aadhaar && !/^[0-9]{4}$/.test(aadhaar)) {
      return fail('Only the last four digits of Aadhaar are stored.', 'aadhaar_last4');
    }
    if (uan && !/^[0-9]{12}$/.test(uan)) return fail('A UAN is exactly 12 digits.', 'uan');
    if (esi && !/^[0-9]{10,17}$/.test(esi)) return fail('An ESI IP number is 10 to 17 digits.', 'esi_ip_number');

    const { error: rpcErr } = await supabase.schema('api').rpc('save_statutory', {
      emp: id,
      p_pan: pan || null,
      p_bank_account: nullIfBlank(vals.bank_account),
      p_ifsc: ifsc || null,
      p_bank_name: nullIfBlank(vals.bank_name),
      p_uan: uan || null,
      p_esi_ip: esi || null,
      p_aadhaar_last4: aadhaar || null,
    });
    if (rpcErr) return fail(friendly(rpcErr));

    /* The applicability flags and the tax regime drive the payroll engine and
       hold no secret — but employee_statutory grants no table privileges to
       `authenticated` at all, precisely so the encryption cannot be sidestepped
       by writing columns directly. They go through their own guarded RPC. */
    const { error } = await supabase.schema('api').rpc('set_statutory_flags', {
      emp: id,
      p_tax_regime: str(vals.tax_regime) || 'new',
      p_pf: boolOf(vals.pf_applicable),
      p_pf_on_actual: boolOf(vals.pf_on_actual),
      p_esi: boolOf(vals.esi_applicable),
      p_pt: boolOf(vals.pt_applicable),
      p_lwf: boolOf(vals.lwf_applicable),
    });
    if (error) return fail(friendly(error));

    touch(id);
    return ok('Statutory and bank details saved.');
  } catch (e) {
    return boom(e);
  }
}

/** Unmasks one encrypted field. The database writes an audit row for every call. */
export async function revealStatutory(employeeId: string, field: 'pan' | 'bank_account'): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('people.sensitive.write');
    const { data, error } = await supabase
      .schema('api')
      .rpc('reveal_statutory', { emp: employeeId, field });
    if (error) return fail(friendly(error));
    return ok(undefined, { data: String(data ?? '') });
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------------- lifecycle */

export async function setEmployeeStatus(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const id = str(vals.id);
    const status = str(vals.status);
    const exit = nullIfBlank(vals.exit_date);

    if (['exited', 'inactive'].includes(status) && !exit) {
      return fail('An exit date is required to close a record.', 'exit_date');
    }

    const { error } = await supabase
      .from('employees')
      .update({ status, exit_date: ['exited', 'inactive'].includes(status) ? exit : null })
      .eq('id', id);
    if (error) return fail(friendly(error));

    touch(id);
    return ok(`Status changed to ${status.replace(/_/g, ' ')}.`);
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------ compensation */

export async function saveCompensation(vals: Values): Promise<ActionResult> {
  try {
    // comp_write demands payroll.config with MFA — a different permission from
    // the one that guards PAN and bank details, and held by payroll_admin
    // rather than hr_admin.
    const { v, supabase } = await ctx('payroll.config');
    const id = str(vals.id);
    const ctc = numOrNull(vals.annual_ctc);
    if (!ctc || ctc <= 0) return fail('Annual CTC must be a positive amount.', 'annual_ctc');

    const { error } = await supabase.from('employee_compensation').insert({
      org_id: v.orgId,
      employee_id: id,
      effective_from: str(vals.effective_from),
      annual_ctc: ctc,
      structure_id: str(vals.structure_id),
      grade: nullIfBlank(vals.grade),
      revision_reason: nullIfBlank(vals.revision_reason),
      status: 'draft',
      created_by: v.userId,
    });
    if (error) {
      if (error.code === '23505') {
        return fail('This employee already has a revision effective from that date.', 'effective_from');
      }
      return fail(friendly(error));
    }
    touch(id);
    return ok('Compensation revision saved as a draft.');
  } catch (e) {
    return boom(e);
  }
}

/* -------------------------------------------------------------- masterdata */

/**
 * A brand-new organisation has no departments, designations or locations, which
 * would make the first employee form a dead end. These let the same modal
 * create one inline instead of sending somebody off to a settings screen.
 */
export async function createDepartment(vals: Values): Promise<ActionResult> {
  try {
    // departments_write is keyed to people.write, not settings.write.
    const { v, supabase } = await ctx('people.write');
    const { data, error } = await supabase
      .from('departments')
      .insert({ org_id: v.orgId, name: str(vals.name), code: nullIfBlank(vals.code) })
      .select('id')
      .single();
    if (error) return fail(friendly(error));
    touch();
    return ok(`Department "${str(vals.name)}" created.`, { id: (data as { id: string }).id });
  } catch (e) {
    return boom(e);
  }
}

export async function createDesignation(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('people.write');
    const { data, error } = await supabase
      .from('designations')
      .insert({ org_id: v.orgId, name: str(vals.name), level: numOrNull(vals.level) })
      .select('id')
      .single();
    if (error) return fail(friendly(error));
    touch();
    return ok(`Designation "${str(vals.name)}" created.`, { id: (data as { id: string }).id });
  } catch (e) {
    return boom(e);
  }
}

export async function createLocation(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('settings.write');
    const state = str(vals.state_code).toUpperCase();
    if (!state) return fail('State decides professional tax and LWF, so it is required.', 'state_code');

    const { data, error } = await supabase
      .from('locations')
      .insert({
        org_id: v.orgId,
        name: str(vals.name),
        city: nullIfBlank(vals.city),
        state_code: state,
        address: nullIfBlank(vals.address),
      })
      .select('id')
      .single();
    if (error) return fail(friendly(error));
    touch();
    return ok(`Location "${str(vals.name)}" created.`, { id: (data as { id: string }).id });
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------------ shapes */

function addressOf(v: Values, p: 'cur' | 'per') {
  const line1 = str(v[`${p}_line1`]);
  const line2 = str(v[`${p}_line2`]);
  const city = str(v[`${p}_city`]);
  const state = str(v[`${p}_state`]);
  const pin = str(v[`${p}_pin`]);
  if (!line1 && !city && !state && !pin) return {};
  return { line1, line2, city, state, pin, country: 'India' };
}

function emergencyOf(v: Values) {
  const name = str(v.emg_name);
  const phone = str(v.emg_phone);
  if (!name && !phone) return [];
  return [{ name, relationship: str(v.emg_relation), phone }];
}

/* ---------------------------------------------------- self-service access */

/**
 * Gives an employee a login.
 *
 * Until this existed there was no way at all to get somebody into self service:
 * the portal could change an existing member's role but could not create one,
 * and nothing invited anybody. HR added an employee and the employee had no
 * account, no email and no route in.
 *
 * Three steps, in this order, because the order matters if one of them fails:
 *
 *   1. Create or find the auth user. Supabase sends the activation email; this
 *      is a Supabase Auth email, so it goes out over whatever SMTP the project
 *      has configured rather than needing a sender of our own.
 *   2. Attach that user to the employee record. api.link_employee_login forces
 *      the role to 'employee' and is gated on people.write, so inviting
 *      somebody to read their own payslip does not need the owner-only
 *      members.manage permission and cannot be used to escalate anybody.
 *   3. Queue the welcome email.
 *
 * If step 1 succeeds and step 2 fails, the auth user exists unlinked and a
 * second attempt recovers: inviting an existing address returns 422, which is
 * handled by falling back to a password-reset link for the same account.
 */
export async function inviteEmployee(employeeId: string): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();

    const { data: emp, error: readErr } = await supabase
      .from('employees')
      .select('id,full_name,work_email,status,employee_code')
      .eq('id', str(employeeId))
      .maybeSingle();
    if (readErr) return fail(friendly(readErr));
    if (!emp) return fail('That employee record does not exist.');

    const e = emp as { id: string; full_name: string; work_email: string | null; status: string };
    if (!e.work_email) {
      return fail(
        `${e.full_name} has no work email, so there is nowhere to send the invitation. Add one on their record first.`,
      );
    }
    if (e.status === 'exited') {
      return fail('That employee has left. Reactivating their access is a separate decision.');
    }

    if (!hasServiceRole()) {
      return fail(
        'Inviting an employee needs SUPABASE_SERVICE_ROLE_KEY set on this deployment. Add it in Vercel under Settings, Environment Variables — it must not have a NEXT_PUBLIC_ prefix.',
      );
    }

    const admin = createAdminClient();
    const email = e.work_email.toLowerCase();
    let userId: string | null = null;
    let sent: 'invitation' | 'password reset' = 'invitation';

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: activationRedirectTo(),
      data: { full_name: e.full_name, org_id: v.orgId, employee_id: e.id },
    });

    if (invited?.user) {
      userId = invited.user.id;
    } else if (inviteErr) {
      /* 422 means the address already has an account — somebody re-invited, or
         this person is already a user of another organisation. Send them a
         set-password link for the account that exists instead of reporting a
         failure that is really a duplicate. */
      const already = /already|registered|exists/i.test(inviteErr.message ?? '') || inviteErr.status === 422;
      if (!already) return fail(`The invitation could not be sent: ${inviteErr.message}`);

      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
      if (!found) {
        return fail(
          'That address already has an account, but it could not be found to send a reset link. Ask them to use "Forgot password" on the sign-in page.',
        );
      }
      userId = found.id;
      const { error: resetErr } = await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: activationRedirectTo(),
      });
      if (resetErr) return fail(`A set-password email could not be sent: ${resetErr.message}`);
      sent = 'password reset';
    }

    if (!userId) return fail('The account could not be created. Try again.');

    const { data: linked, error: linkErr } = await supabase
      .schema('api')
      .rpc('link_employee_login', { p_employee: e.id, p_user: userId });
    if (linkErr) {
      const m = linkErr.message ?? '';
      if (/EMPLOYEE_HAS_LOGIN/.test(m)) {
        return fail(
          `${e.full_name} already has a different login attached. Unlink it under Settings, People and roles before attaching another.`,
        );
      }
      return fail(friendly(linkErr));
    }

    await supabase.schema('api').rpc('queue_employee_welcome', { p_employee: e.id });

    touch(e.id);
    revalidatePath('/settings');

    const status = (linked as { status?: string } | null)?.status;
    if (status === 'already_linked') {
      return ok(`A fresh ${sent} email has been sent to ${email}. Their account was already linked.`);
    }
    if (status === 'attached_to_existing') {
      return ok(
        `${email} already had access to this organisation, so their existing login is now linked to this employee record. A ${sent} email has been sent.`,
      );
    }
    return ok(
      `Invitation sent to ${email}. They set a password, enrol an authenticator, and then have self service. Nothing else is needed from you.`,
    );
  } catch (e) {
    return boom(e);
  }
}

/**
 * Confirms anybody whose probation has run out.
 *
 * Called when the Employees page loads, because there is no scheduler in this
 * project. That is less tidy than a cron job but it is self-healing: the
 * confirmation happens the first time HR opens the page on or after the due
 * date, and the recorded effective date is the real due date rather than the
 * day somebody noticed. The function is idempotent, so a page refresh does
 * nothing the second time.
 */
export async function confirmDueProbations(): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const { data, error } = await supabase
      .schema('api')
      .rpc('confirm_due_probations', { p_org: v.orgId });
    if (error) return fail(friendly(error));

    const r = (data ?? {}) as { confirmed?: number; names?: string[] };
    if (!r.confirmed) return ok();

    touch();
    return ok(
      `${r.confirmed} employee(s) confirmed as permanent: ${(r.names ?? []).join(', ')}. Each has been told in the portal and an email is queued.`,
    );
  } catch (e) {
    return boom(e);
  }
}
