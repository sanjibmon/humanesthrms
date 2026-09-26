'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, numOrNull, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';
import { buildFiling, type FilingData, type BuiltFile } from '@/lib/filings';

/**
 * Statutory filings.
 *
 * The register is generated from the calendar — app.generate_filings creates a
 * row per obligation per period with its due date — and the file content is
 * built here, on the server, from app.filing_data.
 *
 * One rule runs through all of it: only pay runs in status locked or paid are
 * read. A computed or approved run can still change, and a return filed on
 * figures that later moved is a revised return, a penalty, and a conversation
 * nobody wants to have. The database enforces it; this file does not get a say.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/compliance');
  revalidatePath('/dashboard');
};

async function ctx(perm: string) {
  const v = await getViewer();
  if (!v.orgId) throw new Error('This account is not a member of any organisation.');
  if (!v.can(perm)) {
    throw new Error(
      perm === 'compliance.file'
        ? 'Your role cannot prepare or file statutory returns.'
        : 'Your role cannot see statutory filings.',
    );
  }
  return { v, supabase: createClient() };
}

/** Creates the filing calendar for a month, idempotently. */
export async function generateFilings(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('compliance.file');
    const month = str(vals.period_month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Pick the month.', 'period_month');

    const { data, error } = await supabase
      .schema('api')
      .rpc('generate_filings', { p_org: v.orgId, p_month: month });
    if (error) return fail(friendly(error));

    touch();
    const n = Number(data ?? 0);
    return ok(
      n
        ? `${n} filing(s) added to the calendar for ${month}. Anything already there was left alone.`
        : `Everything for ${month} is already on the calendar.`,
    );
  } catch (e) {
    return boom(e);
  }
}

export type FilingExport =
  | { ok: true; filename: string; mime: string; content: string; problems: string[]; notes: string[]; rowCount: number }
  | { ok: false; error: string };

/**
 * Builds the file for one filing and hands it back to the browser to save.
 *
 * Nothing is written to storage. That is deliberate for now: these files carry
 * names, UANs, insurance numbers and, for Form 16, full PANs, and parking them
 * in a bucket creates a second copy of the most sensitive data in the system
 * with its own lifetime and its own access rules. The download is audited
 * instead.
 */
export async function exportFiling(filingId: string): Promise<FilingExport> {
  try {
    const { v, supabase } = await ctx('compliance.read');

    const { data: filing, error: fErr } = await supabase
      .from('statutory_filings')
      .select('id,filing_type,period,state_code,entity_id')
      .eq('id', str(filingId))
      .maybeSingle();
    if (fErr) return { ok: false, error: friendly(fErr) };
    if (!filing) return { ok: false, error: 'That filing is not on the calendar.' };

    const f = filing as any;
    const { data, error } = await supabase.schema('api').rpc('filing_data', {
      p_org: v.orgId,
      p_type: f.filing_type,
      p_period: f.period,
      p_entity: f.entity_id,
    });
    if (error) return { ok: false, error: friendly(error) };

    const payload = data as unknown as FilingData;
    if (!payload?.rows?.length) {
      return {
        ok: false,
        error:
          'No locked or paid pay run covers this period, so there is nothing to file yet. Lock the run first — a return filed off figures that can still change has to be revised later.',
      };
    }

    const built: BuiltFile = buildFiling(f.filing_type, payload, f.state_code ?? undefined);

    /* One audit row naming the filing, so a bulk PAN reveal for Form 16 or 24Q
       is traceable rather than invisible. */
    await supabase.schema('api').rpc('note_filing_export', {
      p_org: v.orgId,
      p_detail: {
        filingId: f.id,
        type: f.filing_type,
        period: f.period,
        rows: built.rowCount,
        panRevealed: !!payload.panRevealed,
      },
    });

    return {
      ok: true,
      filename: built.filename,
      mime: built.mime,
      content: built.content,
      problems: built.problems,
      notes: built.notes,
      rowCount: built.rowCount,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build the file.' };
  }
}

/** Records the amount the return came to, once the working has been checked. */
export async function prepareFiling(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('compliance.file');
    const amount = numOrNull(vals.amount);
    if (amount === null || amount < 0) return fail('Enter the amount this return comes to.', 'amount');

    const { error } = await supabase
      .from('statutory_filings')
      .update({
        status: 'prepared',
        amount,
        prepared_by: v.userId,
        notes: nullIfBlank(vals.notes),
      })
      .eq('id', str(vals.id));
    if (error) return fail(friendly(error));

    touch();
    return ok('Marked as prepared.');
  } catch (e) {
    return boom(e);
  }
}

/** Closes a filing with the acknowledgement the portal gave back. */
export async function markFilingFiled(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('compliance.file');
    const reference = str(vals.reference_no);
    const filedOn = str(vals.filed_on);
    if (!reference) {
      return fail('Enter the acknowledgement or challan number the portal gave you.', 'reference_no');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn)) return fail('When was it filed?', 'filed_on');
    if (filedOn > new Date().toISOString().slice(0, 10)) {
      return fail('That date is in the future.', 'filed_on');
    }

    const amount = numOrNull(vals.amount);
    const { error } = await supabase
      .from('statutory_filings')
      .update({
        status: 'filed',
        reference_no: reference,
        filed_on: filedOn,
        filed_by: v.userId,
        ...(amount !== null ? { amount } : {}),
        notes: nullIfBlank(vals.notes),
      })
      .eq('id', str(vals.id));
    if (error) return fail(friendly(error));

    touch();
    return ok('Filed. The acknowledgement is on the record.');
  } catch (e) {
    return boom(e);
  }
}

export async function addManualFiling(vals: Values): Promise<ActionResult> {
  try {
    const { v, supabase } = await ctx('compliance.file');
    const type = str(vals.filing_type);
    const period = str(vals.period);
    if (!type) return fail('Which return is it?', 'filing_type');
    if (!period) return fail('Which period does it cover?', 'period');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(vals.due_date))) return fail('When is it due?', 'due_date');

    const { error } = await supabase.from('statutory_filings').insert({
      org_id: v.orgId,
      entity_id: nullIfBlank(vals.entity_id),
      filing_type: type,
      state_code: nullIfBlank(vals.state_code),
      period,
      due_date: str(vals.due_date),
      status: 'pending',
      notes: nullIfBlank(vals.notes),
    });
    if (error) {
      if (error.code === '23505') return fail('That filing is already on the calendar.');
      return fail(friendly(error));
    }

    touch();
    return ok('Added to the calendar.');
  } catch (e) {
    return boom(e);
  }
}
