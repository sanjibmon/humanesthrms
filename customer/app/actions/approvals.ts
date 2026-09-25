'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/components/customer-shell';
import { ok, fail, friendly, str, nullIfBlank, type ActionResult } from '@/lib/action';
import type { Values } from '@/components/ui/form';

/**
 * Approvals.
 *
 * None of the decision logic lives here. app.decide_approval owns it: it locks
 * the request, checks that the caller really is the approver for the *current*
 * level (by employee id or by permission), refuses to let anyone decide their
 * own request, advances to the next level or finalises, and writes the audit
 * row. This file is a thin, well-behaved caller.
 *
 * approval_requests and approval_steps have SELECT policies only — there is no
 * write policy at all — so the RPC is the sole way in by design.
 */

function boom(e: unknown): ActionResult {
  return fail(e instanceof Error ? e.message : 'Something went wrong.');
}

const touch = () => {
  revalidatePath('/inbox');
  revalidatePath('/dashboard');
  revalidatePath('/leave');
  revalidatePath('/attendance');
  revalidatePath('/expense');
  revalidatePath('/me/leave');
  revalidatePath('/me/attendance');
  revalidatePath('/me/expenses');
};

export async function decideApproval(vals: Values): Promise<ActionResult> {
  try {
    const v = await getViewer();
    if (!v.orgId) return fail('This account is not a member of any organisation.');

    const decision = str(vals.decision);
    if (!['approve', 'reject', 'forward'].includes(decision)) {
      return fail('Pick approve, reject or forward.', 'decision');
    }
    const comment = str(vals.comment);
    if (decision === 'reject' && comment === '') {
      // Not a database rule — a rejection without a reason is a support ticket
      // waiting to happen, and the requester can see this comment.
      return fail('Say why you are rejecting it. The requester sees this.', 'comment');
    }
    if (decision === 'forward' && !str(vals.forward_to)) {
      return fail('Choose who to forward it to.', 'forward_to');
    }

    const supabase = createClient();
    const { data, error } = await supabase.schema('api').rpc('decide_approval', {
      req: str(vals.id),
      decision,
      p_comment: nullIfBlank(comment),
      p_forward_to: decision === 'forward' ? str(vals.forward_to) : null,
    });
    if (error) return fail(friendly(error));

    touch();
    const outcome = String(data ?? '');
    return ok(
      outcome === 'approved'
        ? 'Approved. The request is now complete.'
        : outcome === 'rejected'
          ? 'Rejected. The requester has been told.'
          : outcome === 'forwarded'
            ? 'Forwarded. It now sits with the person you chose.'
            : 'Approved at your level. It has moved to the next approver.',
    );
  } catch (e) {
    return boom(e);
  }
}

/** Marks one notification read. Own rows only — notif_update sees to that. */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return fail(friendly(error));
    revalidatePath('/inbox');
    return ok();
  } catch (e) {
    return boom(e);
  }
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  try {
    const v = await getViewer();
    const supabase = createClient();
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', v.userId)
      .is('read_at', null);
    if (error) return fail(friendly(error));
    revalidatePath('/inbox');
    return ok('All caught up.');
  } catch (e) {
    return boom(e);
  }
}
