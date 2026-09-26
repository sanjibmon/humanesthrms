'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, boolOf, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';
import { runPayroll } from '@/lib/payroll/runner';
import type { PayrollInputs } from '@/lib/payroll/runner';
import type { GradeTemplate } from '@/lib/payroll/structure';

/**
 * Payroll.
 *
 * The split is deliberate and worth stating, because it is what makes a payslip
 * from eighteen months ago still reproducible:
 *
 *   The database owns the data, the inputs contract and the run state machine.
 *     api.payroll_inputs(run) gathers everything a month needs — compensation,
 *     the structure template, the day calendar, adjustments, loans, tax
 *     declarations, the year-to-date carried forward from the last approved
 *     run, and whether ESI is locked in for the contribution period.
 *
 *   The engine in lib/payroll does the arithmetic. No I/O, no dates of its own,
 *     every statutory rate an effective-dated entry rather than a constant. It
 *     has 50 tests covering PF ceilings and the EPS split, the ESI
 *     contribution-period lock-in, professional tax by state including the
 *     Maharashtra February adjustment, both tax regimes with rebate, surcharge
 *     and marginal relief, the labour-code wage floor, and loss-of-pay
 *     proration.
 *
 *   api.save_pay_run_items writes the results back and moves the run to
 *     'computed', storing the statutory parameters and engine version it used.
 *
 * A run goes draft -> computed -> approved -> locked -> paid. A locked run is
 * immutable; corrections belong in the next month as arrears, or in an
 * off-cycle run. That is not a limitation of this code, it is how payroll has
 * to work when returns have already been filed on the numbers.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = (runId?: string) => {
  revalidatePath('/payroll');
  if (runId) revalidatePath(`/payroll/${runId}`);
  revalidatePath('/dashboard');
  revalidatePath('/me/payroll');
};

async function ctx(perm: string) {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) {
    throw new Error(
      perm === 'payroll.config'
        ? 'Your role cannot configure salary structures.'
        : perm === 'payroll.approve'
          ? 'Your role cannot approve a pay run. That is deliberately a second pair of eyes.'
          : perm === 'payroll.pay'
            ? 'Your role cannot mark a run as paid. Releasing money is its own permission.'
            : 'Your role cannot run payroll.',
    );
  }
  return { v, supabase: createClient() };
}

/* ------------------------------------------------------- salary structures */

/**
 * Turns the form into the engine's GradeTemplate. The percentages are the
 * common Indian split; the balance component absorbs whatever is left so the
 * structure always adds up to CTC exactly rather than to CTC minus rounding.
 */
export async function saveSalaryStructure(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('payroll.config');

    const basicPct = numOrNull(vals.basic_pct) ?? 50;
    const hraPct = numOrNull(vals.hra_pct) ?? 50;
    if (basicPct < 1 || basicPct > 100) return fail('Basic has to be between 1 and 100 per cent.', 'basic_pct');

    const components: GradeTemplate['components'] = [
      {
        code: 'BASIC',
        name: 'Basic',
        calc: { type: 'pct_ctc', pct: basicPct },
        treatment: 'wage',
        taxable: true,
        prorate: true,
        showInPayslip: true,
        isBasic: true,
      },
      {
        code: 'HRA',
        name: 'House Rent Allowance',
        calc: { type: 'pct_basic', pct: hraPct },
        treatment: 'excluded',
        taxable: true,
        prorate: true,
        showInPayslip: true,
      },
    ];

    if (numOrNull(vals.conveyance) ?? 0) {
      components.push({
        code: 'CONV', name: 'Conveyance Allowance',
        calc: { type: 'fixed', amount: numOrNull(vals.conveyance) as number },
        treatment: 'excluded', taxable: true, prorate: true, showInPayslip: true,
      });
    }
    if (numOrNull(vals.medical) ?? 0) {
      components.push({
        code: 'MED', name: 'Medical Allowance',
        calc: { type: 'fixed', amount: numOrNull(vals.medical) as number },
        treatment: 'excluded', taxable: true, prorate: true, showInPayslip: true,
      });
    }
    // Always last: it takes the remainder, so the components reconcile to CTC.
    components.push({
      code: 'SPECIAL', name: 'Special Allowance',
      calc: { type: 'balance' },
      treatment: 'excluded', taxable: true, prorate: true, showInPayslip: true,
    });

    const template: GradeTemplate = {
      grade: str(vals.code).toUpperCase(),
      name: str(vals.name),
      components,
      ctcIncludesEmployerCosts: boolOf(vals.ctc_includes_employer_costs),
    };

    const row = {
      org_id: v.orgId,
      code: str(vals.code).toUpperCase(),
      name: str(vals.name),
      template,
      is_active: vals.is_active === undefined ? true : boolOf(vals.is_active),
    };

    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('salary_structures').update(row).eq('id', id)
      : await supabase.from('salary_structures').insert(row);
    if (error) {
      if (error.code === '23505') return fail('That code is already used by another structure.', 'code');
      return fail(friendly(error));
    }

    touch();
    revalidatePath('/employees');
    return ok(id ? 'Structure updated.' : 'Structure created. It can now be used on a compensation revision.');
  } catch (e) {
    return boom(e);
  }
}

/* ----------------------------------------------------------- compensation */

/**
 * Approving compensation is what makes an employee visible to a pay run.
 *
 * app.compensation_guard enforces two things this cannot talk its way around:
 * whoever raised the revision cannot approve it, and an approved revision is
 * immutable — a change is a new revision with a later effective date, so the
 * salary history stays intact.
 */
export async function approveCompensation(id: string): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('payroll.config');
    const { error } = await supabase
      .from('employee_compensation')
      .update({ status: 'approved', approved_by: v.userId, approved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      if (/maker.?checker/i.test(error.message ?? '')) {
        return fail(
          'You raised this revision, so somebody else has to approve it. Ask another person with payroll configuration rights, or turn maker–checker off in Settings.',
        );
      }
      if (/immutable/i.test(error.message ?? '')) {
        return fail('That revision is already approved. Changing it means adding a new revision with a later effective date.');
      }
      return fail(friendly(error));
    }
    touch();
    revalidatePath('/employees');
    return ok('Compensation approved. Payroll will pick it up from its effective date.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------- pay runs */

export async function createPayRun(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('payroll.run');
    const month = str(vals.period_month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Pick the month to run.', 'period_month');

    const { data, error } = await supabase.schema('api').rpc('create_pay_run', {
      p_org: v.orgId,
      p_month: month,
      p_entity: nullIfBlank(vals.entity_id),
      p_type: str(vals.run_type) || 'regular',
    });
    if (error) return fail(friendly(error));

    touch();
    return ok(`Draft run created for ${month}. Compute it to see the register.`, { id: String(data ?? '') });
  } catch (e) {
    return boom(e);
  }
}

/**
 * Pulls the inputs, runs the engine, writes the results back. Everything the
 * engine needed is in the inputs, so this is reproducible: the same run
 * recomputed gives the same numbers, and the parameters it used are stored
 * alongside the result.
 */
export async function computePayRun(runId: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.run');

    const { data: raw, error: inErr } = await supabase
      .schema('api')
      .rpc('payroll_inputs', { p_run: runId });
    if (inErr) return fail(friendly(inErr));

    const inputs = raw as unknown as PayrollInputs;
    if (!inputs?.employees?.length) {
      const why = inputs?.skipped?.length
        ? ` ${inputs.skipped.length} employee(s) were skipped: ${[...new Set(inputs.skipped.map((s) => s.reason))].join('; ')}.`
        : '';
      return fail(`Nothing to pay this month.${why}`);
    }

    const out = runPayroll(inputs);

    const { error: saveErr } = await supabase.schema('api').rpc('save_pay_run_items', {
      p_run: runId,
      p_items: out.items,
      p_params: out.params,
      p_engine_version: out.engineVersion,
    });
    if (saveErr) return fail(friendly(saveErr));

    touch(runId);
    const notes: string[] = [];
    if (out.warnings.length) notes.push(`${out.warnings.length} warning(s)`);
    if (out.skipped.length) notes.push(`${out.skipped.length} employee(s) skipped`);
    return ok(
      `Computed ${out.items.length} employee(s)${notes.length ? ` — ${notes.join(', ')}` : ''}.`,
      { data: { warnings: out.warnings, skipped: out.skipped } },
    );
  } catch (e) {
    return boom(e);
  }
}

export async function approvePayRun(runId: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.approve');
    const { error } = await supabase.schema('api').rpc('approve_pay_run', { p_run: runId });
    if (error) return fail(payrollMessage(error));
    touch(runId);
    return ok('Approved. It can now be locked.');
  } catch (e) {
    return boom(e);
  }
}

export async function lockPayRun(runId: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.approve');
    const { error } = await supabase.schema('api').rpc('lock_pay_run', { p_run: runId });
    if (error) return fail(payrollMessage(error));
    touch(runId);
    return ok('Locked. The figures are now final and the attendance behind them is frozen.');
  } catch (e) {
    return boom(e);
  }
}

export async function markPayRunPaid(runId: string): Promise<ActionResult> {
  try {
    // payroll.pay, not payroll.approve — releasing money is its own permission.
    const { supabase } = await ctx('payroll.pay');
    const { error } = await supabase.schema('api').rpc('mark_pay_run_paid', { p_run: runId });
    if (error) return fail(payrollMessage(error));
    touch(runId);
    return ok('Marked as paid.');
  } catch (e) {
    return boom(e);
  }
}

export async function publishPayslips(runId: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.run');
    const { data, error } = await supabase.schema('api').rpc('publish_payslips', { p_run: runId });
    if (error) return fail(payrollMessage(error));
    touch(runId);
    const n = Number(data ?? 0);
    return ok(
      n ? `${n} payslip(s) published. Employees can see them now.` : 'Payslips published.',
    );
  } catch (e) {
    return boom(e);
  }
}

export async function reopenPayRun(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.approve');
    const reason = str(vals.reason);
    if (reason.length < 5) return fail('Reopening a run is audited. Say why.', 'reason');

    const { error } = await supabase
      .schema('api')
      .rpc('reopen_pay_run', { p_run: str(vals.id), p_reason: reason });
    if (error) return fail(payrollMessage(error));
    touch(str(vals.id));
    return ok('Reopened. Recompute before approving again.');
  } catch (e) {
    return boom(e);
  }
}

function payrollMessage(e: { message?: string; code?: string }): string {
  const m = e.message ?? '';
  if (/maker.?checker|same person|approved by/i.test(m)) {
    return 'Payroll needs a second pair of eyes: whoever computed a run cannot approve it. Ask another payroll approver, or turn maker–checker off in Settings.';
  }
  if (/is locked|already locked|immutable/i.test(m)) {
    return 'This run is locked. Corrections go in the next month as arrears, or in an off-cycle run.';
  }
  if (/not .*(computed|approved)/i.test(m)) return m;
  return friendly(e);
}

/* -------------------------------------------------------- adjustments */

/** One-off additions and deductions the next run will pick up. */
export async function savePayAdjustment(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('payroll.run');
    const amount = numOrNull(vals.amount);
    if (!amount || amount <= 0) return fail('Enter the amount.', 'amount');

    const { error } = await supabase.from('pay_adjustments').insert({
      org_id: v.orgId,
      employee_id: str(vals.employee_id),
      period_month: str(vals.period_month),
      kind: str(vals.kind),
      description: nullIfBlank(vals.description),
      amount,
      status: 'pending',
      created_by: v.userId,
    });
    if (error) return fail(friendly(error));
    touch();
    return ok('Adjustment saved. The next computation for that month will include it.');
  } catch (e) {
    return boom(e);
  }
}

export async function deletePayAdjustment(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await ctx('payroll.run');
    const { error } = await supabase.from('pay_adjustments').delete().eq('id', id);
    if (error) return fail(friendly(error));
    touch();
    return ok('Adjustment removed.');
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------------------ bank advice */

export type BankAdvice =
  | { ok: true; filename: string; content: string; rows: number; problems: string[]; total: number }
  | { ok: false; error: string };

/**
 * The file the bank actually needs to move the money.
 *
 * This is the most sensitive read in the product, so it is gated harder than
 * anything else: api.bank_advice requires payroll.pay AND pii.reveal AND a
 * second factor, refuses a run that is not locked, and writes one audit row
 * naming the run and how many accounts were read. Held items and zero or
 * negative nets are left out, because a held payslip is deliberately not paid.
 *
 * Anybody without those two permissions gets the register CSV instead, which
 * carries no account numbers at all.
 */
export async function bankAdvice(runId: string): Promise<BankAdvice> {
  try {
    const { supabase } = await ctx('payroll.pay');
    const { data, error } = await supabase.schema('api').rpc('bank_advice', { p_run: runId });
    if (error) {
      const m = error.message ?? '';
      if (/pii\.reveal|reveal account/i.test(m)) {
        return {
          ok: false,
          error:
            'A bank file needs permission to reveal account numbers, which your role does not have. That is separate from being allowed to pay, on purpose.',
        };
      }
      if (/locked run/i.test(m)) {
        return { ok: false, error: 'Lock the run first. A bank file off figures that can still change is how people get paid twice.' };
      }
      return { ok: false, error: friendly(error) };
    }

    const p = data as any;
    const rows = (p?.rows ?? []) as {
      code: string; name: string; net: number; account: string | null; ifsc: string | null; bankName: string | null;
    }[];
    if (rows.length === 0) {
      return { ok: false, error: 'Nothing to pay in this run — every item is held, or every net is zero.' };
    }

    const problems: string[] = [];
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['Beneficiary name,Account number,IFSC,Amount,Reference'];
    let total = 0;

    for (const r of rows) {
      if (!r.account || !r.ifsc) {
        problems.push(
          `${r.name} (${r.code}) has no ${!r.account ? 'bank account' : 'IFSC'} on record and is left out of the file.`,
        );
        continue;
      }
      total += Number(r.net);
      lines.push(
        [
          esc(r.name),
          esc(r.account),
          esc(r.ifsc),
          Math.round(Number(r.net)),
          esc(`SAL ${p.run?.month ?? ''} ${r.code}`),
        ].join(','),
      );
    }

    return {
      ok: true,
      filename: `Bank_advice_${p.run?.month ?? 'run'}.csv`,
      content: `﻿${lines.join('\r\n')}`,
      rows: lines.length - 1,
      problems,
      total,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build the bank file.' };
  }
}
