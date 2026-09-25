'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

/**
 * Employee self service.
 *
 * Every write here belongs to the signed-in employee and nobody else, and the
 * database is what enforces that — leave_requests and attendance_regularizations
 * carry SELECT policies only, so the security-definer RPCs are the single way
 * in. Those RPCs are where the real rules live, and they are worth knowing
 * because the messages they raise are shown to the user verbatim:
 *
 *   app.apply_leave          probation period, gender-specific types, weekly
 *                            offs and holidays excluded from the day count,
 *                            document required past a threshold, overlapping
 *                            leave, balance including other pending requests,
 *                            and it builds the approval chain — manager, then
 *                            HR, then department head for long leave, skipping
 *                            the manager when the manager is themselves away.
 *   app.request_regularization  31-day window, no future dates.
 *   app.submit_expense       at least one line, claim must still be a draft.
 *
 * Nothing above is re-implemented here. The checks in this file exist only to
 * catch an obvious mistake while the form is still open.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/me/leave');
  revalidatePath('/me/attendance');
  revalidatePath('/me/expenses');
  revalidatePath('/me/assets');
  revalidatePath('/inbox');
  revalidatePath('/dashboard');
};

async function ctx() {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.employeeId) {
    throw new Error(
      'This sign-in is not linked to an employee record, so there is nothing to apply for. Ask HR to link it.',
    );
  }
  return { v, supabase: createClient() };
}

/* -------------------------------------------------------------------- leave */

export async function applyLeave(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();

    const from = str(vals.from_date);
    const to = str(vals.to_date) || from;
    if (!from) return fail('Pick a start date.', 'from_date');
    if (to < from) return fail('The end date is before the start date.', 'to_date');

    const half = str(vals.half_day) || 'none';
    if (half !== 'none' && from !== to) {
      return fail('A half day has to be a single date.', 'half_day');
    }

    const { data, error } = await supabase.schema('api').rpc('apply_leave', {
      p_type: str(vals.leave_type_id),
      p_from: from,
      p_to: to,
      p_half: half,
      p_reason: nullIfBlank(vals.reason),
      p_doc: nullIfBlank(vals.document_path),
    });
    if (error) return fail(leaveMessage(error));

    touch();
    return ok('Applied. It is now with your approver.', { id: String(data ?? '') });
  } catch (e) {
    return boom(e);
  }
}

/**
 * app.apply_leave raises prefixed messages so the caller can say something
 * useful rather than dumping a Postgres error into the page.
 */
function leaveMessage(e: { message?: string; code?: string }): string {
  const m = e.message ?? '';
  if (m.startsWith('BALANCE:')) {
    return `You do not have enough balance. ${m.replace('BALANCE:', '').trim()}. Requests already pending count against it.`;
  }
  if (m.startsWith('OVERLAP:')) return 'You already have leave booked that overlaps these dates.';
  if (m.startsWith('PROBATION:')) return m.replace('PROBATION:', '').trim();
  if (m.startsWith('GENDER:')) return m.replace('GENDER:', '').trim();
  if (m.startsWith('DOCUMENT:')) {
    return `${m.replace('DOCUMENT:', '').trim()}. Upload it on your documents page first.`;
  }
  if (m.includes('all weekly offs or holidays')) {
    return 'Those dates are all weekly offs or holidays, so no leave would be deducted.';
  }
  return friendly(e);
}

export async function cancelLeave(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.schema('api').rpc('cancel_leave', { p_leave: id });
    if (error) return fail(friendly(error));
    touch();
    return ok('Cancelled. Any days already deducted have been returned to your balance.');
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------------- attendance */

export async function requestRegularization(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();

    const date = str(vals.work_date);
    if (!date) return fail('Pick the date to regularise.', 'work_date');

    const type = str(vals.request_type) || 'missed_in';
    const reason = str(vals.reason);
    if (reason.length < 3) return fail('Give a reason your approver can act on.', 'reason');

    // The columns are timestamps; the form collects clock times against the day.
    const stamp = (t: string) => (t ? new Date(`${date}T${t}:00`).toISOString() : null);

    const { error } = await supabase.schema('api').rpc('request_regularization', {
      p_date: date,
      p_type: type,
      p_in: stamp(str(vals.in_time)),
      p_out: stamp(str(vals.out_time)),
      p_reason: reason,
    });
    if (error) {
      const m = error.message ?? '';
      if (m.includes('31 days')) return fail('Regularisation only goes back 31 days.', 'work_date');
      if (m.includes('future date')) return fail('You cannot regularise a date that has not happened.', 'work_date');
      return fail(friendly(error));
    }

    touch();
    return ok('Sent to your approver.');
  } catch (e) {
    return boom(e);
  }
}

/* ----------------------------------------------------------------- expenses */

export async function createExpenseClaim(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const { data, error } = await supabase
      .from('expense_claims')
      .insert({
        org_id: v.orgId,
        employee_id: v.employeeId,
        title: str(vals.title),
        status: 'draft',
        total: 0,
      })
      .select('id')
      .single();
    if (error) return fail(friendly(error));
    touch();
    return ok('Draft claim created. Add the lines next.', { id: (data as { id: string }).id });
  } catch (e) {
    return boom(e);
  }
}

export async function addExpenseItem(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const amount = numOrNull(vals.amount);
    if (!amount || amount <= 0) return fail('Enter the amount.', 'amount');

    const { error } = await supabase.from('expense_items').insert({
      org_id: v.orgId,
      claim_id: str(vals.claim_id),
      expense_date: str(vals.expense_date),
      category: str(vals.category),
      merchant: nullIfBlank(vals.merchant),
      amount,
      gst_amount: numOrNull(vals.gst_amount),
      description: nullIfBlank(vals.description),
    });
    if (error) return fail(friendly(error));
    touch();
    return ok('Line added.');
  } catch (e) {
    return boom(e);
  }
}

export async function deleteExpenseItem(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    // claims_update_draft keeps this to the owner's own draft claims.
    const { error } = await supabase.from('expense_items').delete().eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Line removed.');
  } catch (e) {
    return boom(e);
  }
}

export async function submitExpenseClaim(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.schema('api').rpc('submit_expense', { p_claim: id });
    if (error) {
      if ((error.message ?? '').includes('at least one expense line')) {
        return fail('Add at least one line before submitting.');
      }
      return fail(friendly(error));
    }
    touch();
    return ok('Submitted. It goes to your manager, then to finance.');
  } catch (e) {
    return boom(e);
  }
}

export async function deleteExpenseClaim(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.from('expense_claims').delete().eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Draft deleted.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------------- assets */

/** alloc_ack is the one update an employee may make on their own allocation. */
export async function acknowledgeAsset(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase
      .from('asset_allocations')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Acknowledged.');
  } catch (e) {
    return boom(e);
  }
}

/* -------------------------------------------------------------- resignation */

export async function submitResignation(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const lwd = str(vals.last_working_day);
    if (!lwd) return fail('Pick your intended last working day.', 'last_working_day');

    const { error } = await supabase.schema('api').rpc('submit_resignation', {
      p_reason: nullIfBlank(vals.reason),
      p_lwd: lwd,
    });
    if (error) return fail(friendly(error));
    touch();
    return ok('Submitted. Your manager and HR have been notified.');
  } catch (e) {
    return boom(e);
  }
}
