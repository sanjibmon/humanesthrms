'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Modal } from '@/components/ui/modal';
import { RecordForm } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { inr } from '@/lib/format';
import * as V from '@/lib/validate';
import { savePlan, setPlanModule } from '@/app/actions/platform';

export type PlanFull = {
  code: string;
  name: string;
  price_per_seat_paise: number;
  max_seats: number | null;
  is_active: boolean;
  customers: number;
  seats: number;
};

export type ModuleLite = { code: string; name: string; is_core: boolean; sort_order: number };

export function PlanConsole({
  plans,
  modules,
  planModules,
  canWrite,
}: {
  plans: PlanFull[];
  modules: ModuleLite[];
  planModules: Record<string, string[]>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlanFull | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function flip(planCode: string, moduleCode: string, include: boolean) {
    setPending(`${planCode}|${moduleCode}`);
    const res = await setPlanModule(planCode, moduleCode, include);
    setPending(null);
    toast(res.ok ? (res.message ?? 'Updated') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  return (
    <>
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <div key={p.code} className={`card card-hover flex flex-col ${p.code === 'growth' ? 'border-brand' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base">{p.name}</h3>
                <span className="badge mt-1">{p.code}</span>
              </div>
              {p.code === 'growth' ? <span className="badge bg-brand-soft text-brand-dark">Most sold</span> : null}
              {!p.is_active ? <span className="badge bg-slate-line2 text-slate-muted">retired</span> : null}
            </div>

            <p className="mb-1 mt-3 text-[26px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
              {p.price_per_seat_paise === 0 ? 'Free' : inr(p.price_per_seat_paise / 100)}
            </p>
            <p className="text-xs text-slate-muted">
              {p.price_per_seat_paise === 0 ? 'Evaluation only' : 'per seat, per month'}
            </p>

            <dl className="mt-3.5 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-xs text-slate-muted">Seat cap</dt>
              <dd className="font-medium text-ink">{p.max_seats ?? 'Unlimited'}</dd>
              <dt className="text-xs text-slate-muted">Modules</dt>
              <dd className="font-medium tabular-nums text-ink">{(planModules[p.code] ?? []).length}</dd>
              <dt className="text-xs text-slate-muted">Customers</dt>
              <dd className="font-medium tabular-nums text-ink">{p.customers}</dd>
              <dt className="text-xs text-slate-muted">Seats sold</dt>
              <dd className="font-medium tabular-nums text-ink">{p.seats.toLocaleString('en-IN')}</dd>
            </dl>

            {canWrite ? (
              <button className="btn btn-sm mt-4" onClick={() => setEditing(p)}>
                Edit plan
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="text-sm">What each plan includes</h3>
        <p className="mb-3.5 text-xs text-slate-muted">
          Changing a cell here changes what a converting customer gets. Existing customers keep their
          modules until someone re-syncs them from the customer page.
        </p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Module</th>
                {plans.map((p) => (
                  <th key={p.code} className="text-center">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.code}>
                  <td>
                    <b className="block font-semibold text-ink">{m.name}</b>
                    <span className="text-[11px] text-slate-muted">
                      {m.code}
                      {m.is_core ? ' · core' : ''}
                    </span>
                  </td>
                  {plans.map((p) => {
                    const on = (planModules[p.code] ?? []).includes(m.code);
                    const key = `${p.code}|${m.code}`;
                    return (
                      <td key={p.code} className="text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${on ? 'Remove' : 'Add'} ${m.name} ${on ? 'from' : 'to'} ${p.name}`}
                          data-on={on}
                          className="switch mx-auto disabled:opacity-40"
                          disabled={!canWrite || pending !== null}
                          onClick={() => flip(p.code, m.code, !on)}
                        >
                          <i />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <Modal title={`Edit ${editing.name}`} sub={`${editing.customers} customer(s) are on this plan`} onClose={() => setEditing(null)}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Display name', rules: [V.required('Name')] },
              { name: 'price', label: 'Price per seat', type: 'number', rules: [V.nonNegative('Price')], hint: 'In rupees, exclusive of GST.', half: true },
              { name: 'max_seats', label: 'Seat cap', type: 'number', rules: [V.positiveInt('Seat cap')], hint: 'Blank means unlimited.', half: true },
              { name: 'is_active', label: 'Sellable — appears when creating or converting a customer', type: 'switch' },
            ]}
            initial={{
              name: editing.name,
              price: String(editing.price_per_seat_paise / 100),
              max_seats: editing.max_seats === null ? '' : String(editing.max_seats),
              is_active: editing.is_active,
            }}
            action={(v) => savePlan({ ...v, code: editing.code })}
            submitLabel="Save plan"
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            note={
              <p className="flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[12px] leading-relaxed text-amber-text">
                <span className="mt-0.5 shrink-0">
                  <Icon name="alert" size={15} />
                </span>
                <span>
                  A price change applies to the next billing run for every customer on this plan,
                  unless they have a negotiated price on their own licence.
                </span>
              </p>
            }
          />
        </Modal>
      ) : null}
    </>
  );
}
