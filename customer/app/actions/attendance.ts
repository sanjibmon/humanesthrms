'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

/**
 * Attendance, employer side.
 *
 * Two ideas hold this together:
 *
 *   Punches are append-only. attendance_events is the record of what actually
 *   happened; nothing edits or deletes a punch, including HR. A correction is a
 *   new event or an edit to the derived day, never a rewrite of history.
 *
 *   The day is derived. app.recompute_attendance_day turns the events for a
 *   date into first in, last out, worked minutes, lateness and a status, using
 *   the shift that applied on that date. It runs on a trigger after every
 *   event, and it refuses to overwrite a day that is locked or that has been
 *   regularised — so a device sync arriving late cannot undo a decision.
 *
 * An HR edit therefore sets is_regularized, which is not a lie: a human
 * decided that day. Payroll freezes the days it used when a run is locked, and
 * a locked day is refused by the RLS policy itself, not by this file.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  revalidatePath('/me/attendance');
};

async function ctx(perm = 'attendance.write') {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) throw new Error('Your role cannot change attendance records.');
  return { v, supabase: createClient() };
}

const STATUSES = ['present', 'late', 'half_day', 'absent', 'wfh', 'leave', 'holiday', 'weekly_off', 'on_duty'];

/** Combines a work date and an HH:MM into an ISO instant in the org's timezone. */
function atTime(date: string, hhmm: string, tz: string): string | null {
  if (!hhmm) return null;
  // Interpreting a wall-clock time in an arbitrary zone without a date library:
  // build the instant as if UTC, then shift by that zone's offset on that date.
  const naive = new Date(`${date}T${hhmm}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const asZone = new Date(naive.toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive.getTime() + (asUtc.getTime() - asZone.getTime())).toISOString();
}

async function orgTimezone(supabase: ReturnType<typeof createClient>, org: string): Promise<string> {
  const { data } = await supabase.from('organizations').select('timezone').eq('id', org).maybeSingle();
  return ((data as any)?.timezone as string) || 'Asia/Kolkata';
}

/* ------------------------------------------------------------- edit a day */

/**
 * Corrects one day for one employee. The RLS policy carries `not locked`, so a
 * day inside a locked pay run is refused by the database rather than by a
 * check here that could drift from it.
 */
export async function saveAttendanceDay(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const employee = str(vals.employee_id);
    const date = str(vals.work_date);
    const status = str(vals.status);
    if (!employee) return fail('Pick the employee.', 'employee_id');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date.', 'work_date');
    if (!STATUSES.includes(status)) return fail('Pick a status.', 'status');

    const tz = await orgTimezone(supabase, v.orgId as string);
    const first = atTime(date, str(vals.first_in), tz);
    const last = atTime(date, str(vals.last_out), tz);
    if (first && last && new Date(last) <= new Date(first)) {
      return fail('The out time has to be after the in time.', 'last_out');
    }

    const worked = first && last
      ? Math.round((new Date(last).getTime() - new Date(first).getTime()) / 60000)
      : 0;

    const { error } = await supabase.from('attendance_daily').upsert(
      {
        org_id: v.orgId,
        employee_id: employee,
        work_date: date,
        first_in: first,
        last_out: last,
        worked_minutes: worked,
        status,
        overtime_minutes: numOrNull(vals.overtime_minutes) ?? 0,
        source: 'manual',
        // A human decided this day, so a later device sync must not undo it.
        is_regularized: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,work_date' },
    );
    if (error) {
      if (error.code === '42501' || /policy/i.test(error.message ?? '')) {
        return fail('That day is locked by a pay run, so it cannot be changed. Correct it in the next month instead.');
      }
      return fail(friendly(error));
    }

    touch();
    return ok('Day updated.');
  } catch (e) {
    return boom(e);
  }
}

/**
 * Fills a date for everyone who has no record on it. Used at month end, where
 * the gap between "nobody punched" and "nobody was meant to be here" is the
 * difference between a correct payslip and an angry employee.
 */
export async function bulkMarkDay(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const date = str(vals.work_date);
    const status = str(vals.status);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date.', 'work_date');
    if (!STATUSES.includes(status)) return fail('Pick a status.', 'status');

    const [{ data: staff }, { data: existing }] = await Promise.all([
      supabase.from('employees').select('id').eq('org_id', v.orgId).eq('status', 'active'),
      supabase.from('attendance_daily').select('employee_id').eq('org_id', v.orgId).eq('work_date', date),
    ]);

    const have = new Set(((existing ?? []) as any[]).map((r) => r.employee_id as string));
    const missing = ((staff ?? []) as any[]).map((e) => e.id as string).filter((id) => !have.has(id));
    if (missing.length === 0) return ok('Every active employee already has a record for that day.');

    const { error } = await supabase.from('attendance_daily').insert(
      missing.map((id) => ({
        org_id: v.orgId,
        employee_id: id,
        work_date: date,
        status,
        source: 'manual',
        worked_minutes: 0,
      })),
    );
    if (error) return fail(friendly(error));

    touch();
    return ok(`${missing.length} employee(s) marked ${status.replace(/_/g, ' ')} on ${date}. Days that already had a record were left alone.`);
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------ add a punch */

/**
 * Records a punch on an employee's behalf — the biometric reader was down, or
 * somebody was at a client site. It goes in as an event rather than as a day,
 * so the trigger derives the day exactly as it would for a real punch and the
 * audit trail shows who entered it.
 */
export async function addPunch(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const employee = str(vals.employee_id);
    const date = str(vals.work_date);
    const time = str(vals.event_time);
    const type = str(vals.event_type);
    if (!employee) return fail('Pick the employee.', 'employee_id');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date.', 'work_date');
    if (!/^\d{2}:\d{2}$/.test(time)) return fail('Enter the time as HH:MM.', 'event_time');
    if (!['in', 'out'].includes(type)) return fail('In or out?', 'event_type');

    const tz = await orgTimezone(supabase, v.orgId as string);
    const at = atTime(date, time, tz);
    if (!at) return fail('That date and time did not parse.', 'event_time');

    const { error } = await supabase.from('attendance_events').insert({
      org_id: v.orgId,
      employee_id: employee,
      event_time: at,
      event_type: type,
      source: 'manual',
      created_by: v.userId,
    });
    if (error) return fail(friendly(error));

    touch();
    return ok('Punch recorded. The day has been recalculated from it.');
  } catch (e) {
    return boom(e);
  }
}

/* --------------------------------------------------------------- devices */

export async function saveAttendanceDevice(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const name = str(vals.name);
    if (!name) return fail('Name the device.', 'name');

    const row = {
      org_id: v.orgId,
      name,
      device_type: str(vals.device_type) || 'biometric',
      vendor: nullIfBlank(vals.vendor),
      serial_no: nullIfBlank(vals.serial_no),
      location_id: nullIfBlank(vals.location_id),
      // The database allows online, offline and unknown. A device that has
      // never synced is unknown, not online — claiming otherwise hides a fault.
      status: str(vals.status) || 'unknown',
    };

    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('attendance_devices').update(row).eq('id', id)
      : await supabase.from('attendance_devices').insert(row);
    if (error) return fail(friendly(error));

    touch();
    return ok(id ? 'Device updated.' : 'Device added.');
  } catch (e) {
    return boom(e);
  }
}

/* -------------------------------------------------------------- overtime */

/**
 * Approves the overtime recorded for a month.
 *
 * attendance_daily keeps recorded and approved minutes apart on purpose:
 * recorded is what the clock says, approved is what somebody signed off, and
 * payroll only ever prices the second. A day inside a locked run is skipped,
 * because the money for that month has already gone out.
 */
export async function approveOvertime(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('attendance.approve');
    const month = str(vals.period_month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Pick the month.', 'period_month');

    const { data, error } = await supabase.schema('api').rpc('approve_overtime', {
      p_org: v.orgId,
      p_month: month,
      p_employee: nullIfBlank(vals.employee_id),
    });
    if (error) return fail(friendly(error));

    const r = (data ?? {}) as { days?: number; minutes?: number };
    touch();
    return ok(
      r.days
        ? `${r.days} day(s) approved — ${hours(r.minutes ?? 0)} of overtime for ${month}.`
        : `Nothing left to approve for ${month}. ${hours(r.minutes ?? 0)} is already approved.`,
    );
  } catch (e) {
    return boom(e);
  }
}

/**
 * Sends approved overtime to payroll as one adjustment per employee. Replaces
 * any earlier one for the month rather than adding to it, so approving a few
 * more hours and pushing again corrects the figure instead of doubling it.
 */
export async function pushOvertimeToPayroll(vals: Values): Promise<ActionResult> {
  try {
    const v = await getViewer();
    if (!v.orgId) return fail('This account is not a member of any organisation.');
    if (!v.can('payroll.run')) {
      return fail('Sending hours to payroll needs the payroll.run permission, which your role does not have.');
    }
    const month = str(vals.period_month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Pick the month.', 'period_month');

    const supabase = createClient();
    const { data, error } = await supabase
      .schema('api')
      .rpc('push_overtime_to_payroll', { p_org: v.orgId, p_month: month });
    if (error) return fail(friendly(error));

    const n = Number((data as any)?.employees ?? 0);
    touch();
    revalidatePath('/payroll');
    return ok(
      n
        ? `${n} employee(s) sent to payroll for ${month}. Recompute the run to price the hours.`
        : 'No approved overtime for that month.',
    );
  } catch (e) {
    return boom(e);
  }
}

const hours = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m ? ` ${m}m` : ''}`;
};

/* ----------------------------------------------------------- shift roster */

/** Puts an employee on a shift from a date, ending any assignment it overlaps. */
export async function assignShift(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx();
    const shift = str(vals.shift_id);
    const from = str(vals.effective_from);
    const ids = String(vals.employee_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    if (!shift) return fail('Pick the shift.', 'shift_id');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return fail('From when?', 'effective_from');
    if (ids.length === 0) return fail('Pick at least one employee.', 'employee_ids');

    const to = nullIfBlank(vals.effective_to);
    if (to && to < from) return fail('The end date is before the start date.', 'effective_to');

    /* Close the open assignment each employee already has, the day before this
       one starts. Two open assignments would make the shift for a date
       ambiguous, and recompute_attendance_day picks by effective_from — so the
       older one would silently keep winning on a tie. */
    const prev = new Date(`${from}T00:00:00`);
    prev.setDate(prev.getDate() - 1);
    const closeOn = prev.toISOString().slice(0, 10);

    const { error: closeErr } = await supabase
      .from('employee_shifts')
      .update({ effective_to: closeOn })
      .in('employee_id', ids)
      .is('effective_to', null)
      .lt('effective_from', from);
    if (closeErr) return fail(friendly(closeErr));

    const { error } = await supabase.from('employee_shifts').insert(
      ids.map((id) => ({
        org_id: v.orgId,
        employee_id: id,
        shift_id: shift,
        effective_from: from,
        effective_to: to,
      })),
    );
    if (error) return fail(friendly(error));

    revalidatePath('/shifts');
    touch();
    return ok(
      `${ids.length} employee(s) moved to that shift from ${from}. Any earlier assignment was closed the day before, so no date has two shifts.`,
    );
  } catch (e) {
    return boom(e);
  }
}

export async function endShiftAssignment(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx();
    const on = str(vals.effective_to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return fail('Ending on which date?', 'effective_to');

    const { error } = await supabase
      .from('employee_shifts')
      .update({ effective_to: on })
      .eq('id', str(vals.id));
    if (error) return fail(friendly(error));

    revalidatePath('/shifts');
    touch();
    return ok('Assignment ended.');
  } catch (e) {
    return boom(e);
  }
}
