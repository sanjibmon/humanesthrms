'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';
import { compareRegimes, type Regime } from '@/lib/payroll/tds';
import { buildStructure, type GradeTemplate } from '@/lib/payroll/structure';
import { resolveStatutory } from '@/lib/payroll/params';
import { taxYearOf } from '@/lib/payroll/util';
import { SECTIONS, itemsToDeclarations, type DeclItem } from '@/lib/tax-sections';

/**
 * Tax declarations and proof verification.
 *
 * This is the piece that makes TDS real. app.payroll_inputs already reads
 * declarations — it maps each section to the key the engine expects and takes
 * coalesce(verified_amount, declared_amount) for every item that is not
 * rejected, from any declaration in status submitted, verified or locked. So
 * until an employee submits something, every payslip in the organisation is
 * computed as though nobody has any deduction at all, which for most people on
 * the old regime is wrong by a large margin.
 *
 * Two deliberate consequences of that rule, worth knowing before changing it:
 *
 *   A submitted declaration counts at its declared value straight away. The
 *   employee does not have to wait for HR to see the benefit in their payslip,
 *   which is what everybody expects in April. Verification then replaces the
 *   declared figure with the proved one, and the difference is recovered over
 *   the remaining months rather than in one shock.
 *
 *   Rejecting an item is not the same as setting it to zero. A rejected item is
 *   excluded outright; a verified amount of zero says somebody looked and found
 *   nothing. Both end up at zero in the tax, but only one of them is a record
 *   of a decision.
 *
 * The regime lives in two places on purpose: tax_declarations.regime is what
 * the employee chose, employee_statutory.tax_regime is what payroll actually
 * uses. Verifying a declaration is the moment the two are reconciled.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/me/tax');
  revalidatePath('/payroll');
  revalidatePath('/me/payroll');
};

/* ------------------------------------------------------- employee: declare */

async function meCtx() {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.employeeId) {
    throw new Error('This sign-in is not linked to an employee record, so it has no tax declaration.');
  }
  return { v, supabase: createClient() };
}

/** Creates this year's declaration if it does not exist, and returns its id. */
export async function openDeclaration(fyStart: number): Promise<ActionResult> {
  try {
    const { v, supabase } = await meCtx();
    const { data: existing } = await supabase
      .from('tax_declarations')
      .select('id')
      .eq('employee_id', v.employeeId)
      .eq('fy_start', fyStart)
      .maybeSingle();
    if (existing) return ok(undefined, { id: (existing as any).id });

    /* The regime defaults to whatever payroll is already using for this person,
       so opening the form does not silently change their tax. */
    const { data: stat } = await supabase
      .from('employee_statutory')
      .select('tax_regime')
      .eq('employee_id', v.employeeId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('tax_declarations')
      .insert({
        org_id: v.orgId,
        employee_id: v.employeeId,
        fy_start: fyStart,
        regime: ((stat as any)?.tax_regime as string) || 'new',
        status: 'draft',
      })
      .select('id')
      .maybeSingle();
    if (error) return fail(friendly(error));
    return ok('Declaration started.', { id: (data as any)?.id });
  } catch (e) {
    return boom(e);
  }
}

export async function setDeclarationRegime(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await meCtx();
    const regime = str(vals.regime);
    if (!['old', 'new'].includes(regime)) return fail('Pick a regime.', 'regime');

    const { error } = await supabase
      .from('tax_declarations')
      .update({ regime })
      .eq('id', str(vals.id));
    if (error) return fail(declMessage(error));

    touch();
    return ok(
      regime === 'old'
        ? 'Switched to the old regime. Your deductions now reduce your tax, so declare them.'
        : 'Switched to the new regime. Only the employer NPS contribution reduces tax here — the rest of the sections will not change it.',
    );
  } catch (e) {
    return boom(e);
  }
}

export async function saveDeclarationItem(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await meCtx();
    const section = str(vals.section);
    const amount = numOrNull(vals.declared_amount);
    if (!SECTIONS.some((x) => x.value === section)) return fail('Pick a section.', 'section');
    if (amount === null || amount < 0) return fail('Enter the amount for the year.', 'declared_amount');
    if (amount > 50000000) return fail('That figure looks wrong. Check it.', 'declared_amount');
    if (section === 'rent' && !str(vals.city)) {
      return fail('Which city do you rent in? The HRA exemption is higher in the metros.', 'city');
    }

    const row = {
      org_id: v.orgId,
      declaration_id: str(vals.declaration_id),
      section,
      description: nullIfBlank(vals.description),
      declared_amount: amount,
      city: section === 'rent' ? nullIfBlank(vals.city) : null,
      status: 'pending',
      // A changed figure is a new claim, so any earlier verification lapses.
      verified_amount: null,
    };

    const id = str(vals.id);
    const { error } = id
      ? await supabase.from('tax_declaration_items').update(row).eq('id', id)
      : await supabase.from('tax_declaration_items').insert(row);
    if (error) return fail(declMessage(error));

    touch();
    return ok(id ? 'Updated.' : 'Added.');
  } catch (e) {
    return boom(e);
  }
}

export async function deleteDeclarationItem(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await meCtx();
    const { error } = await supabase.from('tax_declaration_items').delete().eq('id', str(id));
    if (error) return fail(declMessage(error));
    touch();
    return ok('Removed.');
  } catch (e) {
    return boom(e);
  }
}

export async function submitDeclaration(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await meCtx();
    const { error } = await supabase
      .from('tax_declarations')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', str(id));
    if (error) return fail(declMessage(error));
    touch();
    return ok(
      'Submitted. Your declared figures take effect in the next payslip — you do not have to wait for the proofs to be checked.',
    );
  } catch (e) {
    return boom(e);
  }
}

/* ------------------------------------------------- employee: which regime? */

export type RegimeComparison = {
  ok: true;
  grossSalary: number;
  oldTax: number;
  newTax: number;
  better: Regime;
  saving: number;
  basis: string;
} | { ok: false; reason: string };

/**
 * Runs both regimes over this employee's own numbers and says which is cheaper.
 *
 * It is a projection, not a promise: it annualises the current structure, so a
 * mid-year revision, a bonus or a month of loss of pay will move it. Saying that
 * plainly matters more than the number.
 */
export async function compareMyRegimes(fyStart: number): Promise<RegimeComparison> {
  try {
    const { v, supabase } = await meCtx();

    const [{ data: comp }, { data: decl }] = await Promise.all([
      supabase
        .from('employee_compensation')
        .select('annual_ctc, structure_id, effective_from, status')
        .eq('employee_id', v.employeeId)
        .eq('status', 'approved')
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('tax_declarations')
        .select('id, regime, tax_declaration_items(section, declared_amount, verified_amount, status, city)')
        .eq('employee_id', v.employeeId)
        .eq('fy_start', fyStart)
        .maybeSingle(),
    ]);

    if (!comp) return { ok: false, reason: 'No approved salary on record yet, so there is nothing to compare.' };

    const { data: structRow } = await supabase
      .from('salary_structures')
      .select('template')
      .eq('id', (comp as any).structure_id)
      .maybeSingle();
    if (!structRow) return { ok: false, reason: 'The salary structure behind your compensation is missing.' };

    const month = `${fyStart}-04`;
    const params = resolveStatutory(month);
    const built = buildStructure(Number((comp as any).annual_ctc), (structRow as any).template as GradeTemplate, {
      params,
      wageDefinition: 'labour_code',
    });

    const pick = (code: string) => Number(built.components.find((c) => c.code === code)?.monthly ?? 0);
    const monthlyGross = built.grossMonthly;
    const basic = built.components.filter((c) => c.isBasic).reduce((a, c) => a + c.monthly, 0) || pick('BASIC');
    const hra = pick('HRA');
    const pf = Math.min(basic, params.pf.wageCeiling) * params.pf.employeeRate;

    const declarations = itemsToDeclarations(
      ((decl as any)?.tax_declaration_items ?? []) as DeclItem[],
    );

    const cmp = compareRegimes({
      taxYear: taxYearOf(month),
      grossSalary: monthlyGross * 12,
      basicDaAnnual: basic * 12,
      hraAnnual: hra * 12,
      employeePfAnnual: pf * 12,
      ptAnnual: 2500,
      declarations,
    });

    return {
      ok: true,
      grossSalary: monthlyGross * 12,
      oldTax: cmp.old.totalTax,
      newTax: cmp.new.totalTax,
      better: cmp.better,
      saving: cmp.saving,
      basis: 'Projected over a full year from your current salary and what you have declared so far.',
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not compare.' };
  }
}

/* ------------------------------------------------------ payroll: verify it */

async function payrollCtx() {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can('payroll.run')) throw new Error('Your role cannot verify tax declarations.');
  return { v, supabase: createClient() };
}

/** Accepts an item at a proved figure, or rejects it with a reason. */
export async function verifyDeclarationItem(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await payrollCtx();
    const decision = str(vals.decision);
    if (!['accepted', 'rejected'].includes(decision)) return fail('Accept or reject?', 'decision');

    const verified = numOrNull(vals.verified_amount);
    if (decision === 'accepted' && (verified === null || verified < 0)) {
      return fail('Enter the amount the proof actually supports.', 'verified_amount');
    }

    const { error } = await supabase
      .from('tax_declaration_items')
      .update({
        status: decision,
        // Rejected items are excluded outright, so the figure is left alone as
        // a record of what was claimed.
        verified_amount: decision === 'accepted' ? verified : null,
        description: nullIfBlank(vals.description),
      })
      .eq('id', str(vals.id));
    if (error) return fail(friendly(error));

    touch();
    return ok(decision === 'accepted' ? 'Accepted.' : 'Rejected. It will not reduce their tax.');
  } catch (e) {
    return boom(e);
  }
}

/**
 * Closes verification for a declaration and reconciles the regime, because the
 * regime payroll uses lives on employee_statutory, not on the declaration.
 */
export async function verifyDeclaration(vals: Values): Promise<ActionResult> {
  try {
    const { supabase } = await payrollCtx();
    const id = str(vals.id);
    const regime = str(vals.regime);

    /* One RPC, not two updates. Closing the declaration and switching the
       regime payroll actually applies have to happen together — done
       separately, a verified declaration sitting against the wrong regime
       looks right on screen and produces a wrong payslip every month. The
       function carries the narrow authority to do the second half, because
       employee_statutory.tax_regime otherwise needs people.sensitive.write,
       which payroll deliberately does not have. */
    const { data, error } = await supabase.schema('api').rpc('verify_tax_declaration', { p_decl: id });
    if (error) {
      const m = error.message ?? '';
      const stuck = /DECIDE_ITEMS:(\d+)/.exec(m);
      if (stuck) {
        return fail(
          `${stuck[1]} item(s) still have no decision. Accept or reject each one first — an untouched item still counts at the declared figure.`,
        );
      }
      if (/not submitted/i.test(m)) return fail('The employee has not submitted this declaration yet.');
      if (/locked/i.test(m)) return fail('That year is locked — Form 16 has already been issued on it.');
      return fail(friendly(error));
    }

    const applied = String(data ?? regime ?? '');
    touch();
    return ok(
      applied
        ? `Verified. Payroll will tax them under the ${applied} regime from the next computation.`
        : 'Verified.',
    );
  } catch (e) {
    return boom(e);
  }
}

/** Locks the year once Form 16 has been issued; nothing can change after that. */
export async function lockDeclaration(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await payrollCtx();
    const { error } = await supabase.from('tax_declarations').update({ status: 'locked' }).eq('id', str(id));
    if (error) return fail(friendly(error));
    touch();
    return ok('Locked for the year.');
  } catch (e) {
    return boom(e);
  }
}

/** Form 12B: what the employee earned and paid elsewhere before joining. */
export async function savePriorEmployerIncome(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await payrollCtx();
    const employee = str(vals.employee_id);
    const fy = Number(str(vals.fy_start));
    const income = numOrNull(vals.income) ?? 0;
    const tds = numOrNull(vals.tds) ?? 0;
    if (!employee) return fail('Pick the employee.', 'employee_id');
    if (!Number.isInteger(fy) || fy < 2020) return fail('Enter the financial year.', 'fy_start');
    if (income < 0 || tds < 0) return fail('Figures cannot be negative.', 'income');
    if (tds > income) return fail('Tax deducted cannot be more than the income it was deducted from.', 'tds');

    const { data: existing } = await supabase
      .from('prior_employer_income')
      .select('id')
      .eq('employee_id', employee)
      .eq('fy_start', fy)
      .maybeSingle();

    const { error } = existing
      ? await supabase.from('prior_employer_income').update({ income, tds }).eq('id', (existing as any).id)
      : await supabase.from('prior_employer_income').insert({ org_id: v.orgId, employee_id: employee, fy_start: fy, income, tds });
    if (error) return fail(friendly(error));

    touch();
    return ok('Saved. Payroll will add it to the year and credit the tax already deducted.');
  } catch (e) {
    return boom(e);
  }
}

function declMessage(e: { message?: string; code?: string }): string {
  const m = e.message ?? '';
  if (e.code === '42501' || /policy|row-level/i.test(m)) {
    return 'This declaration has already been verified, so it cannot be changed. Ask payroll if something is wrong with it.';
  }
  if (e.code === '23505') return 'You already have a declaration for that financial year.';
  return friendly(e);
}
