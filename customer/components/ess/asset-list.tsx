'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/shell';
import { dateLabel } from '@/lib/format';
import { acknowledgeAsset } from '@/app/actions/ess';

export type AllocationRow = {
  id: string;
  name: string;
  asset_tag: string | null;
  category: string | null;
  serial_no: string | null;
  allocated_on: string;
  returned_on: string | null;
  condition_out: string | null;
  condition_in: string | null;
  acknowledged_at: string | null;
};

export function AssetList({ rows }: { rows: AllocationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function ack(id: string) {
    setBusy(id);
    const res = await acknowledgeAsset(id);
    setBusy(null);
    toast(res.ok ? (res.message ?? 'Acknowledged') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="laptop"
        title="Nothing issued to you"
        body="Laptops, phones, access cards and anything else the company hands you appear here, with the condition they were issued in."
      />
    );
  }

  const held = rows.filter((r) => !r.returned_on);
  const returned = rows.filter((r) => r.returned_on);

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <h3 className="mb-3 text-sm">Currently with you</h3>
        {held.length === 0 ? (
          <p className="text-[13px] text-slate-muted">Nothing outstanding.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {held.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-ink">{r.name}</b>
                  <span className="block text-[11px] text-slate-muted">
                    {[r.asset_tag, r.category, r.serial_no ? `serial ${r.serial_no}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="block text-[11px] text-slate-muted">
                    Issued {dateLabel(r.allocated_on)}
                    {r.condition_out ? ` · condition: ${r.condition_out}` : ''}
                  </span>
                </div>
                {r.acknowledged_at ? (
                  <span className="badge bg-leaf-soft text-leaf-text">
                    acknowledged {dateLabel(r.acknowledged_at)}
                  </span>
                ) : (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => ack(r.id)}
                    disabled={busy === r.id}
                  >
                    {busy === r.id ? 'Saving…' : 'Acknowledge receipt'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {returned.length ? (
        <div className="card">
          <h3 className="mb-3 text-sm">Returned</h3>
          <div className="flex flex-col divide-y divide-slate-line2">
            {returned.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-ink">{r.name}</b>
                  <span className="block text-[11px] text-slate-muted">
                    {dateLabel(r.allocated_on)} to {dateLabel(r.returned_on!)}
                    {r.condition_in ? ` · returned ${r.condition_in}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
