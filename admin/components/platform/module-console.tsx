'use client';

import { useState } from 'react';
import { Icon } from '@/components/icon';
import { Rupee } from '@/components/brand';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { inr } from '@/lib/format';
import * as V from '@/lib/validate';
import { saveModule, deleteModule } from '@/app/actions/platform';

export type CatalogModule = {
  code: string;
  name: string;
  description: string;
  version: string;
  is_beta: boolean;
  is_core: boolean;
  default_enabled: boolean;
  addon_price_per_seat_paise: number;
  depends_on: string[];
  sort_order: number;
  in_use: number;
};

function fields(all: CatalogModule[], editing?: CatalogModule): FieldDef[] {
  return [
    { name: 'code', label: 'Code', rules: [V.required('Code')], transform: 'lower', disabled: Boolean(editing), hint: 'Permanent. Lowercase letters, numbers and underscores.', half: true },
    { name: 'name', label: 'Display name', rules: [V.required('Name')], half: true },
    { name: 'description', label: 'Description', type: 'textarea', rules: [V.required('Description')] },
    { name: 'version', label: 'Version', placeholder: '1.0.0', half: true },
    { name: 'sort_order', label: 'Sort order', type: 'number', rules: [V.nonNegative('Sort order')], hint: 'Also the dependency order used when syncing a plan.', half: true },
    { name: 'addon_price', label: 'Add-on price per seat', type: 'number', rules: [V.nonNegative('Price')], hint: 'In rupees, on top of the plan price. Zero for included modules.', half: true },
    {
      name: 'depends_on',
      label: 'Depends on',
      half: true,
      hint: 'Comma-separated module codes that must be on first.',
      placeholder: all
        .filter((m) => m.code !== editing?.code)
        .slice(0, 3)
        .map((m) => m.code)
        .join(', '),
    },
    { name: 'is_core', label: 'Core module — cannot be disabled for any customer', type: 'switch' },
    { name: 'default_enabled', label: 'Enabled by default on new customers', type: 'switch' },
    { name: 'is_beta', label: 'Beta — shown with a warning badge', type: 'switch' },
  ];
}

export function ModuleConsole({ modules, canWrite }: { modules: CatalogModule[]; canWrite: boolean }) {
  const [open, setOpen] = useState<{ kind: 'new' } | { kind: 'edit' | 'delete'; row: CatalogModule } | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      {canWrite ? (
        <div className="mb-4 flex justify-end">
          <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>
            <Icon name="plus" size={16} />
            Add Module
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <div key={m.code} className="card card-hover relative flex flex-col">
            {m.is_beta ? <span className="badge absolute right-4 top-4 bg-amber-bg text-amber-text">Beta</span> : null}

            <div className="mb-2.5 flex items-start justify-between">
              {m.code === 'payroll' ? (
                <Rupee large />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon name={m.is_core ? 'shieldcheck' : 'puzzle'} size={20} />
                </span>
              )}
              <span className="text-right text-[11px] text-slate-muted">
                <b className="block text-sm font-bold tabular-nums text-ink">{m.in_use}</b>
                customers
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <h3 className="text-sm">{m.name}</h3>
              <span className="badge text-[10px]">{m.version}</span>
            </div>
            <p className="mb-2.5 mt-1.5 min-h-[32px] text-xs leading-relaxed text-slate-muted">{m.description}</p>

            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <span className="badge">{m.code}</span>
              {m.is_core ? (
                <span className="badge bg-amber-bg text-amber-text">
                  <Icon name="lock" size={11} />
                  Mandatory
                </span>
              ) : null}
              {m.default_enabled ? <span className="badge bg-leaf-soft text-leaf-text">Default on</span> : null}
              <span className="badge bg-brand-soft text-brand-dark">
                {m.addon_price_per_seat_paise ? `+${inr(m.addon_price_per_seat_paise / 100)}/seat` : 'Included'}
              </span>
            </div>

            {m.depends_on?.length ? (
              <p className="mb-2.5 flex items-center gap-1 text-[11px] text-amber-text">
                <Icon name="alert" size={11} />
                Requires {m.depends_on.join(', ')}
              </p>
            ) : null}

            {canWrite ? (
              <div className="mt-auto flex gap-2 pt-1">
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'edit', row: m })}>
                  Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setOpen({ kind: 'delete', row: m })}>
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {open?.kind === 'new' ? (
        <Modal title="Add a module to the catalog" sub="It becomes available to put on plans and enable per customer." wide onClose={close}>
          <RecordForm
            fields={fields(modules)}
            initial={{ version: '1.0.0', sort_order: String(modules.length + 1), addon_price: '0' }}
            action={saveModule}
            submitLabel="Add module"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'edit' ? (
        <Modal title={`Edit ${open.row.name}`} sub={`Enabled for ${open.row.in_use} customer(s)`} wide onClose={close}>
          <RecordForm
            fields={fields(modules, open.row)}
            initial={{
              code: open.row.code,
              name: open.row.name,
              description: open.row.description,
              version: open.row.version,
              sort_order: String(open.row.sort_order),
              addon_price: String(open.row.addon_price_per_seat_paise / 100),
              depends_on: (open.row.depends_on ?? []).join(', '),
              is_core: open.row.is_core,
              default_enabled: open.row.default_enabled,
              is_beta: open.row.is_beta,
            }}
            action={(v) => saveModule({ ...v, code: open.row.code })}
            submitLabel="Save module"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'delete' ? (
        <Modal title={`Delete ${open.row.name}`} onClose={close}>
          <RecordForm
            fields={[{ name: 'confirm', label: 'Type the module code to confirm', rules: [V.required('Confirmation')], placeholder: open.row.code }]}
            action={(v) =>
              String(v.confirm).trim() === open.row.code
                ? deleteModule({ code: open.row.code })
                : Promise.resolve({ ok: false as const, error: 'The typed code does not match.', field: 'confirm' })
            }
            submitLabel="Delete module"
            onDone={close}
            onCancel={close}
            note={
              <div className="flex gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[12px] leading-relaxed text-red-700">
                <span className="mt-0.5 shrink-0">
                  <Icon name="alert" size={16} />
                </span>
                <span>
                  {open.row.in_use > 0
                    ? `${open.row.in_use} customer(s) still have this enabled — the delete will be refused until you disable it for them.`
                    : 'No customer has this enabled, so removing it is safe. Plans referencing it lose the row too.'}
                </span>
              </div>
            }
          />
        </Modal>
      ) : null}
    </>
  );
}
