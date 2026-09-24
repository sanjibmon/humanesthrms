'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole, inviteRedirectTo } from '@/lib/supabase/admin';
import { requirePlatform, PermissionError } from '@/lib/guard';
import { ok, fail, friendly, str, nullIfBlank, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

function boom(e: unknown): ActionResult {
  if (e instanceof PermissionError) return fail(e.message);
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

/* ======================================================= platform users */

export async function invitePlatformUser(v: Values): Promise<ActionResult> {
  try {
    const me = await requirePlatform('manage_platform_users');
    if (!hasServiceRole()) {
      return fail('Inviting staff needs SUPABASE_SERVICE_ROLE_KEY in the environment.');
    }

    const email = str(v.email).toLowerCase();
    const role = str(v.role);
    if (!['super_admin', 'support', 'sales', 'finance'].includes(role)) {
      return fail('Pick one of the four platform roles.', 'role');
    }
    if (email === me.email.toLowerCase()) return fail('That is your own account.', 'email');

    /* Every member of HumaNest staff has to be reachable out of hours — a
       platform user is somebody who can suspend a customer or touch a payroll
       run. The database enforces this too; catching it here keeps the error in
       the form rather than in a Postgres message. */
    const phone = str(v.phone).trim();
    if (phone === '') return fail('A contact number is required.', 'phone');

    const admin = createAdminClient();
    let userId: string | null = null;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteRedirectTo(),
      data: { platform_role: role },
    });

    if (inviteErr) {
      if (!/already been registered|already exists/i.test(inviteErr.message)) {
        return fail(`Could not send the invitation: ${inviteErr.message}`, 'email');
      }
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = list.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null;
      if (!userId) return fail('That email already has an account that could not be found.', 'email');
    } else {
      userId = invited.user?.id ?? null;
    }
    if (!userId) return fail('The invitation went out but no user id came back.');

    const supabase = createClient();
    const { error } = await supabase.from('platform_users').upsert(
      { id: userId, email, full_name: str(v.full_name) || email, role, phone, is_active: true },
      { onConflict: 'id' },
    );
    if (error) {
      if (error.code === '23505') return fail('A platform user with that email already exists.', 'email');
      return fail(friendly(error));
    }

    revalidatePath('/users');
    return ok(`Invitation sent to ${email}. They set a password, then enrol an authenticator.`);
  } catch (e) {
    return boom(e);
  }
}

export async function updatePlatformUser(v: Values): Promise<ActionResult> {
  try {
    const me = await requirePlatform('manage_platform_users');
    const id = str(v.id);
    const role = str(v.role);
    const supabase = createClient();

    if (id === me.userId && role !== 'super_admin') {
      return fail('You cannot take away your own super admin role — ask another super admin.', 'role');
    }

    const phone = str(v.phone).trim();
    if (phone === '') return fail('A contact number is required.', 'phone');

    const { error } = await supabase
      .from('platform_users')
      .update({ full_name: str(v.full_name), role, phone })
      .eq('id', id);
    if (error) return fail(friendly(error), /contact number/i.test(error.message) ? 'phone' : undefined);

    revalidatePath('/users');
    return ok('Platform user updated.');
  } catch (e) {
    return boom(e);
  }
}

export async function setPlatformUserActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const me = await requirePlatform('manage_platform_users');
    if (id === me.userId && !active) return fail('You cannot deactivate your own account.');

    const supabase = createClient();
    if (!active) {
      const { count } = await supabase
        .from('platform_users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true);
      const { data: target } = await supabase.from('platform_users').select('role').eq('id', id).maybeSingle();
      if ((target as { role: string } | null)?.role === 'super_admin' && (count ?? 0) <= 1) {
        return fail('That is the last active super admin. Promote someone else first.');
      }
    }

    const { error } = await supabase.from('platform_users').update({ is_active: active }).eq('id', id);
    if (error) return fail(friendly(error));

    revalidatePath('/users');
    return ok(active ? 'Account reactivated.' : 'Account deactivated — they can no longer sign in.');
  } catch (e) {
    return boom(e);
  }
}

export async function deletePlatformUser(v: Values): Promise<ActionResult> {
  try {
    const me = await requirePlatform('manage_platform_users');
    const id = str(v.id);
    if (id === me.userId) return fail('You cannot delete your own account.');

    const supabase = createClient();
    const { data: target } = await supabase
      .from('platform_users')
      .select('email, role')
      .eq('id', id)
      .maybeSingle();
    const t = target as { email: string; role: string } | null;
    if (!t) return fail('That account no longer exists.');
    if (str(v.confirm_email).toLowerCase() !== t.email.toLowerCase()) {
      return fail('The typed email does not match this account.', 'confirm_email');
    }

    const { error } = await supabase.from('platform_users').delete().eq('id', id);
    if (error) return fail(friendly(error));

    // Remove the sign-in itself, not just the platform row.
    if (hasServiceRole()) {
      await createAdminClient().auth.admin.deleteUser(id);
    }

    revalidatePath('/users');
    return ok(`${t.email} removed from the platform.`);
  } catch (e) {
    return boom(e);
  }
}

/* ============================================================== modules */

export async function saveModule(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('edit_modules');
    const supabase = createClient();

    const code = str(v.code);
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(code)) {
      return fail('Use 3 to 41 lowercase letters, numbers or underscores, starting with a letter.', 'code');
    }

    const depends = str(v.depends_on)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const row = {
      code,
      name: str(v.name),
      description: str(v.description),
      version: str(v.version) || '1.0.0',
      is_beta: v.is_beta === true || v.is_beta === 'true',
      is_core: v.is_core === true || v.is_core === 'true',
      default_enabled: v.default_enabled === true || v.default_enabled === 'true',
      addon_price_per_seat_paise: Math.round((Number(v.addon_price) || 0) * 100),
      depends_on: depends,
      sort_order: Number(v.sort_order) || 99,
    };

    const { error } = await supabase.from('modules').upsert(row, { onConflict: 'code' });
    if (error) return fail(friendly(error));

    revalidatePath('/modules');
    return ok(`${row.name} saved.`);
  } catch (e) {
    return boom(e);
  }
}

export async function deleteModule(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('edit_modules');
    const supabase = createClient();
    const code = str(v.code);

    const { count } = await supabase
      .from('organization_modules')
      .select('org_id', { count: 'exact', head: true })
      .eq('module_code', code)
      .eq('enabled', true);
    if ((count ?? 0) > 0) {
      return fail(`${count} customer(s) still have this module enabled. Disable it for them first.`);
    }

    const { error } = await supabase.from('modules').delete().eq('code', code);
    if (error) return fail(friendly(error));

    revalidatePath('/modules');
    return ok('Module removed from the catalog.');
  } catch (e) {
    return boom(e);
  }
}

/* ================================================================ plans */

export async function savePlan(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('manage_licenses');
    const supabase = createClient();

    const code = str(v.code);
    if (!['starter', 'growth', 'enterprise', 'trial'].includes(code)) {
      return fail(
        'The database currently allows only starter, growth, enterprise and trial. Adding a new plan code needs a migration.',
        'code',
      );
    }

    const maxSeats = str(v.max_seats);
    const { error } = await supabase
      .from('plans')
      .update({
        name: str(v.name),
        price_per_seat_paise: Math.round((Number(v.price) || 0) * 100),
        max_seats: maxSeats === '' ? null : Number(maxSeats),
        is_active: v.is_active === true || v.is_active === 'true',
      })
      .eq('code', code);
    if (error) return fail(friendly(error));

    revalidatePath('/licenses');
    return ok(`${str(v.name)} updated.`);
  } catch (e) {
    return boom(e);
  }
}

export async function setPlanModule(
  planCode: string,
  moduleCode: string,
  include: boolean,
): Promise<ActionResult> {
  try {
    await requirePlatform('manage_licenses');
    const supabase = createClient();

    const { data: plan } = await supabase.from('plans').select('id').eq('code', planCode).maybeSingle();
    if (!plan) return fail('That plan no longer exists.');
    const planId = (plan as { id: string }).id;

    const { error } = include
      ? await supabase.from('plan_modules').upsert({ plan_id: planId, module_code: moduleCode }, { onConflict: 'plan_id,module_code' })
      : await supabase.from('plan_modules').delete().eq('plan_id', planId).eq('module_code', moduleCode);
    if (error) return fail(friendly(error));

    revalidatePath('/licenses');
    return ok(`${moduleCode.replace(/_/g, ' ')} ${include ? 'added to' : 'removed from'} ${planCode}.`);
  } catch (e) {
    return boom(e);
  }
}

/* ============================================================= support */

export async function saveTicket(v: Values): Promise<ActionResult> {
  try {
    const me = await requirePlatform('support_access');
    const supabase = createClient();
    const id = str(v.id);

    // The live table constrains these three to a short vocabulary.
    const category = str(v.category) || 'technical';
    const priority = str(v.priority) || 'medium';
    const status = str(v.status) || 'open';
    if (!['billing', 'technical', 'feature_request'].includes(category)) {
      return fail('Category must be billing, technical or feature request.', 'category');
    }
    if (!['low', 'medium', 'high'].includes(priority)) {
      return fail('Priority must be low, medium or high.', 'priority');
    }
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return fail('Status must be open, in progress or resolved.', 'status');
    }

    const row: Record<string, unknown> = {
      subject: str(v.subject),
      description: nullIfBlank(v.description),
      category,
      priority,
      status,
      org_id: nullIfBlank(v.org_id),
      assigned_to: nullIfBlank(v.assigned_to) ?? me.userId,
    };

    if (id) {
      const { error } = await supabase.from('platform_support_tickets').update(row).eq('id', id);
      if (error) return fail(friendly(error));
      revalidatePath('/support');
      return ok('Ticket updated.');
    }

    // ticket_no has no default, so give it a readable one: HN-2609-4F2A.
    const stamp = new Date();
    const yy = String(stamp.getFullYear()).slice(2);
    const mm = String(stamp.getMonth() + 1).padStart(2, '0');
    const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
    row.ticket_no = `HN-${yy}${mm}-${tail}`;
    row.raised_by = me.userId;

    const { error } = await supabase.from('platform_support_tickets').insert(row);
    if (error) return fail(friendly(error));

    revalidatePath('/support');
    return ok(`Ticket ${row.ticket_no} raised.`);
  } catch (e) {
    return boom(e);
  }
}

export async function setTicketStatus(id: string, status: string): Promise<ActionResult> {
  try {
    await requirePlatform('support_access');
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return fail('Status must be open, in progress or resolved.');
    }
    const supabase = createClient();
    const { error } = await supabase.from('platform_support_tickets').update({ status }).eq('id', id);
    if (error) return fail(friendly(error));
    revalidatePath('/support');
    return ok(`Ticket marked ${status.replace('_', ' ')}.`);
  } catch (e) {
    return boom(e);
  }
}

export async function deleteTicket(v: Values): Promise<ActionResult> {
  try {
    await requirePlatform('support_access');
    const supabase = createClient();
    const { error } = await supabase.from('platform_support_tickets').delete().eq('id', str(v.id));
    if (error) return fail(friendly(error));
    revalidatePath('/support');
    return ok('Ticket deleted.');
  } catch (e) {
    return boom(e);
  }
}
