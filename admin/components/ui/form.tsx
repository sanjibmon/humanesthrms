'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { toast } from '@/components/ui/toast';
import { runRules, slugify, type Rule } from '@/lib/validate';
import type { ActionResult } from '@/lib/action';

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'date'
  | 'month'
  | 'select'
  | 'textarea'
  | 'switch';

export type FieldDef = {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  rules?: Rule[];
  hint?: string;
  placeholder?: string;
  /** Renders at half width inside the two-column grid. */
  half?: boolean;
  /** Groups fields into a step; the form becomes a wizard when more than one. */
  step?: string;
  /** Forces the typed value into shape as you type. */
  transform?: 'upper' | 'lower' | 'slug';
  /** Fills this field from another one while it has not been edited by hand. */
  mirrorFrom?: string;
  /** Only shown when another field holds one of these values. */
  showWhen?: { field: string; in: string[] };
  disabled?: boolean;
};

export type Values = Record<string, string | boolean>;

const applyTransform = (v: string, t: FieldDef['transform']) =>
  t === 'upper' ? v.toUpperCase() : t === 'lower' ? v.toLowerCase() : t === 'slug' ? slugify(v) : v;

export function isVisible(f: FieldDef, values: Values): boolean {
  if (!f.showWhen) return true;
  return f.showWhen.in.includes(String(values[f.showWhen.field] ?? ''));
}

function FieldControl({
  f,
  value,
  error,
  onChange,
}: {
  f: FieldDef;
  value: string | boolean;
  error?: string;
  onChange: (v: string | boolean) => void;
}) {
  const id = `f-${f.name}`;
  const type = f.type ?? 'text';

  if (type === 'switch') {
    const on = value === true || value === 'true';
    return (
      <div className={`field ${f.half ? '' : 'sm:col-span-2'}`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            id={id}
            role="switch"
            aria-checked={on}
            data-on={on}
            className="switch"
            disabled={f.disabled}
            onClick={() => onChange(!on)}
          >
            <i />
          </button>
          <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-ink">
            {f.label}
          </label>
        </div>
        {f.hint ? <span className="hint">{f.hint}</span> : null}
        {error ? <span className="err">{error}</span> : null}
      </div>
    );
  }

  const common = {
    id,
    value: String(value ?? ''),
    placeholder: f.placeholder,
    disabled: f.disabled,
    'aria-invalid': error ? true : undefined,
  };

  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${f.half ? '' : 'sm:col-span-2'}`}>
      <label htmlFor={id} className="lbl">
        {f.label}
      </label>

      {type === 'select' ? (
        <select
          {...common}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        >
          {/* A field whose own options already carry an empty value means
              something by it -- "All locations", "no manager", "unlink". Adding
              this placeholder on top of that gives the select two options with
              the same value, and the browser shows the placeholder as the
              chosen one, so the real choice looks unavailable. Only add it when
              the field has no empty option of its own. */}
          {(f.options ?? []).some((o) => o.value === '') ? null : (
            <option value="">{f.placeholder ?? 'Select…'}</option>
          )}
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          {...common}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={type === 'month' ? 'text' : type}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(applyTransform(e.target.value, f.transform))
          }
        />
      )}

      {f.hint && !error ? <span className="hint">{f.hint}</span> : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}

export function RecordForm({
  fields,
  initial,
  action,
  submitLabel = 'Save',
  onDone,
  onCancel,
  note,
}: {
  fields: FieldDef[];
  initial?: Values;
  action: (values: Values) => Promise<ActionResult>;
  submitLabel?: string;
  onDone?: () => void;
  onCancel?: () => void;
  note?: React.ReactNode;
}) {
  const router = useRouter();

  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of fields) v[f.name] = initial?.[f.name] ?? (f.type === 'switch' ? false : '');
    return v;
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = useMemo(() => {
    const seen: string[] = [];
    for (const f of fields) {
      const s = f.step ?? '';
      if (s && !seen.includes(s)) seen.push(s);
    }
    return seen;
  }, [fields]);
  const [stepIx, setStepIx] = useState(0);

  const visible = fields.filter((f) => isVisible(f, values));
  const stepFields = steps.length
    ? visible.filter((f) => (f.step ?? steps[0]) === steps[stepIx])
    : visible;

  function set(name: string, v: string | boolean) {
    setValues((prev) => {
      const next: Values = { ...prev, [name]: v };
      // Mirrored fields follow their source until the user types in them.
      for (const f of fields) {
        if (f.mirrorFrom === name && !touched[f.name]) {
          next[f.name] = applyTransform(String(v), f.transform);
        }
      }
      return next;
    });
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));
  }

  function validate(list: FieldDef[]): boolean {
    const next: Record<string, string> = {};
    for (const f of list) {
      if (f.type === 'switch') continue;
      const e = runRules(String(values[f.name] ?? ''), f.rules);
      if (e) next[f.name] = e;
    }
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  }

  async function submit() {
    setFormError(null);
    if (!validate(visible)) {
      // Jump to the first step that still has a problem.
      if (steps.length) {
        const bad = visible.find((f) => errors[f.name]);
        if (bad?.step) setStepIx(Math.max(0, steps.indexOf(bad.step)));
      }
      return;
    }
    setBusy(true);
    const payload: Values = {};
    for (const f of visible) payload[f.name] = values[f.name];
    const res = await action(payload);
    setBusy(false);

    if (res.ok) {
      toast(res.message ?? 'Saved');
      onDone?.();
      router.refresh();
    } else if (res.field) {
      setErrors((prev) => ({ ...prev, [res.field as string]: res.error }));
      if (steps.length) {
        const bad = fields.find((f) => f.name === res.field);
        if (bad?.step) setStepIx(Math.max(0, steps.indexOf(bad.step)));
      }
    } else {
      setFormError(res.error);
    }
  }

  const last = !steps.length || stepIx === steps.length - 1;

  return (
    <div className="flex flex-col gap-4">
      {steps.length > 1 ? (
        <div className="tabbar" role="tablist">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={i === stepIx}
              onClick={() => {
                if (i <= stepIx || validate(stepFields)) setStepIx(i);
              }}
            >
              <span className="mr-1.5 text-[11px] text-slate-faint">{i + 1}</span>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {stepFields.map((f) => (
          <FieldControl
            key={f.name}
            f={f}
            value={values[f.name] ?? ''}
            error={errors[f.name] || undefined}
            onChange={(v) => {
              setTouched((t) => ({ ...t, [f.name]: true }));
              set(f.name, v);
            }}
          />
        ))}
      </div>

      {note}

      {formError ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-700">
          <span className="mt-0.5 shrink-0">
            <Icon name="alert" size={16} />
          </span>
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2.5 border-t border-slate-line2 pt-4">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        {steps.length > 1 && stepIx > 0 ? (
          <button type="button" className="btn" onClick={() => setStepIx(stepIx - 1)} disabled={busy}>
            Back
          </button>
        ) : null}
        {last ? (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (validate(stepFields)) setStepIx(stepIx + 1);
            }}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
