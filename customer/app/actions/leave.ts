'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

/**
 * Leave, employer side.
 *
 * Balances are not a column. leave_balances is a view over leave_ledger, so
 * every figure an employee sees can be traced to the entries that produced it:
 * the opening credit, the annual accrual, each approved application, each
 * adjustment and who made it. Nothing here writes a balance; it writes ledger
 * entries and lets the view do the arithmetic, which is why a balance can
 * never silently disagree with its own history.
 *
 * Deciding an application is not here either — that is app.decide_approval,
 * which debits the ledger and marks the days on the attendance register in one
 * transaction. See app/actions/approvals.ts.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/leave');
  revalidatePath('/dashboard');
  revalidatePath('/me/leave');
};

async function ctx(perm: string) {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) {
    throw new Error(
      perm === 'leave.config'
        ? 'Your role cannot adjust leave balances.'
        : 'Your role cannot act on leave.',
    );
  }
  return { v, supabase: createClient() };
}

/* ------------------------------------------------------------ adjustments */

/** Exactly the set leave_ledger_reason_check allows, less the two the system
 *  writes itself: leave_taken (on approval) and reversal (on cancellation). */
const REASONS = ['opening', 'accrual', 'carry_forward', 'encashment', 'adjustment', 'lapse'];

/**
 * Credits or debits one employee's balance. A positive figure adds days, a
 * negative one takes them away, and the note is what an employee reads when
 * they ask why their balance changed — so it is required rather than optional.
 */
export async function adjustLeaveBalance(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const employee = str(vals.employee_id);
    const type = str(vals.leave_type_id);
    const delta = numOrNull(vals.delta);
    const note = str(vals.note);
    const reason = str(vals.reason) || 'adjustment';

    if (!employee) return fail('Pick the employee.', 'employee_id');
    if (!type) return fail('Pick the leave type.', 'leave_type_id');
    if (delta === null || delta === 0) return fail('Enter how many days to add or take away.', 'delta');
    if (Math.abs(delta) > 365) return fail('That is more than a year of leave. Check the figure.', 'delta');
    if (!note) return fail('Say why. The employee sees this against their balance.', 'note');
    if (!REASONS.includes(reason)) return fail('Pick a reason.', 'reason');

    const entry = str(vals.entry_date) || new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('leave_ledger').insert({
      org_id: v.orgId,
      employee_id: employee,
      leave_type_id: type,
      entry_date: entry,
      leave_year: Number(entry.slice(0, 4)),
      delta,
      reason,
      note,
      created_by: v.userId,
    });
    if (error) return fail(friendly(error));

    touch();
    return ok(`${delta > 0 ? 'Credited' : 'Debited'} ${Math.abs(delta)} day(s).`);
  } catch (e) {
    return boom(e);
  }
}

/**
 * Opens a leave year for everybody at once: one credit per active employee per
 * selected type. Employees who already have a credit of that reason for that
 * year are skipped, so running it twice does not double anyone's balance.
 */
export async function creditLeaveYear(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const type = str(vals.leave_type_id);
    const year = Number(str(vals.leave_year));
    const days = numOrNull(vals.days);
    if (!type) return fail('Pick the leave type.', 'leave_type_id');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail('Enter the leave year.', 'leave_year');
    if (!days || days <= 0) return fail('Enter how many days to credit.', 'days');

    const [{ data: staff }, { data: already }] = await Promise.all([
      supabase.from('employees').select('id').eq('org_id', v.orgId).eq('status', 'active'),
      supabase
        .from('leave_ledger')
        .select('employee_id')
        .eq('org_id', v.orgId)
        .eq('leave_type_id', type)
        .eq('leave_year', year)
        .eq('reason', 'accrual'),
    ]);

    const done = new Set(((already ?? []) as any[]).map((r) => r.employee_id as string));
    const todo = ((staff ?? []) as any[]).map((e) => e.id as string).filter((id) => !done.has(id));
    if (todo.length === 0) return ok('Every active employee already has this year’s credit for that type.');

    const { error } = await supabase.from('leave_ledger').insert(
      todo.map((id) => ({
        org_id: v.orgId,
        employee_id: id,
        leave_type_id: type,
        entry_date: `${year}-01-01`,
        leave_year: year,
        delta: days,
        reason: 'accrual',
        note: `Annual credit for ${year}`,
        created_by: v.userId,
      })),
    );
    if (error) return fail(friendly(error));

    touch();
    return ok(`${todo.length} employee(s) credited ${days} day(s) for ${year}. Anyone already credited was skipped.`);
  } catch (e) {
    return boom(e);
  }
}

/**
 * Cancels an application on an employee's behalf. api.cancel_leave owns the
 * rules — it refuses a leave already taken and refunds the ledger when the
 * application had been approved — so this is only a caller.
 */
export async function cancelLeaveFor(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('leave.approve');
    const { error } = await supabase.schema('api').rpc('cancel_leave', { p_leave: str(id) });
    if (error) return fail(friendly(error));
    touch();
    return ok('Application cancelled and the balance refunded.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------- holidays */

/** The holiday list drives the day calendar payroll prorates against. */
export async function saveHoliday(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const date = str(vals.holiday_date);
    const name = str(vals.name);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date.', 'holiday_date');
    if (!name) return fail('Name the holiday.', 'name');

    const row = {
      org_id: v.orgId,
      holiday_date: date,
      name,
      is_optional: vals.is_optional === true,
      location_id: nullIfBlank(vals.location_id),
    };

    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('holidays').update(row).eq('id', id)
      : await supabase.from('holidays').insert(row);
    if (error) {
      if (error.code === '23505') return fail('That holiday is already on the calendar.', 'holiday_date');
      return fail(friendly(error));
    }

    touch();
    revalidatePath('/settings');
    return ok(id ? 'Holiday updated.' : 'Holiday added.');
  } catch (e) {
    return boom(e);
  }
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('leave.config');
    const { error } = await supabase.from('holidays').delete().eq('id', str(id));
    if (error) return fail(friendly(error));
    touch();
    revalidatePath('/settings');
    return ok('Holiday removed.');
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------------- accrual */

/**
 * Runs accrual for a month: the monthly credit, and at the start of a leave
 * year the carry-forward and the lapse as well.
 *
 * It is safe to press twice, and safe to run late. Every entry is keyed to the
 * first day of the period it is for, so a second run for the same month credits
 * nobody a second time — which matters, because the first thing anybody does
 * with a button like this is press it again to check that it worked.
 *
 * There is no scheduler behind it yet. Until there is, this is run from the
 * screen, or by anything that can call the RPC on the first of the month.
 */
export async function runLeaveAccrual(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('leave.config');
    const month = str(vals.period_month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Pick the month.', 'period_month');

    const { data, error } = await supabase
      .schema('api')
      .rpc('run_leave_accrual', { p_org: v.orgId, p_month: month });
    if (error) return fail(friendly(error));

    const r = (data ?? {}) as { credited?: number; carried?: number; lapsed?: number; yearStart?: boolean };
    const bits: string[] = [];
    if (r.credited) bits.push(`${r.credited} accrual entr${r.credited === 1 ? 'y' : 'ies'}`);
    if (r.carried) bits.push(`${r.carried} carried forward`);
    if (r.lapsed) bits.push(`${r.lapsed} lapsed`);

    touch();
    return ok(
      bits.length
        ? `${month}: ${bits.join(', ')}.${r.yearStart ? ' This is the first month of the leave year, so last year was closed off too.' : ''}`
        : `${month} was already accrued — nothing to add. Running it again is always safe.`,
    );
  } catch (e) {
    return boom(e);
  }
}
