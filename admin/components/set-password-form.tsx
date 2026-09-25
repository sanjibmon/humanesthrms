'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/icon';

const RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 12, label: 'At least 12 characters' },
  { test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v), label: 'Upper and lower case' },
  { test: (v) => /[0-9]/.test(v), label: 'At least one number' },
  { test: (v) => /[^A-Za-z0-9]/.test(v), label: 'At least one symbol' },
];

export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passed = RULES.map((r) => r.test(pw));
  const allPassed = passed.every(Boolean);
  const matches = pw !== '' && pw === again;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!allPassed) return setError('The password does not meet every requirement yet.');
    if (!matches) return setError('The two passwords do not match.');

    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.message);

    // The middleware sends them straight to authenticator enrolment from here.
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-slate-muted">
        Signed in as <b className="text-ink">{email}</b>. Choose a password, then you will be asked
        to set up an authenticator app — HumaNest requires it for every account.
      </p>

      <label className="field">
        <span className="lbl">New password</span>
        <span className="relative block">
          <input
            type={show ? 'text' : 'password'}
            required
            autoComplete="new-password"
            className="pr-11"
            value={pw}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-slate-muted transition hover:bg-slate-surface hover:text-brand"
          >
            <Icon name="lock" size={15} />
          </button>
        </span>
      </label>

      <ul className="flex flex-col gap-1.5">
        {RULES.map((r, i) => (
          <li
            key={r.label}
            className={`flex items-center gap-2 text-[12px] ${passed[i] ? 'text-leaf-text' : 'text-slate-muted'}`}
          >
            <Icon name={passed[i] ? 'checkcircle' : 'alert'} size={13} />
            {r.label}
          </li>
        ))}
      </ul>

      <label className="field">
        <span className="lbl">Confirm password</span>
        <input
          type={show ? 'text' : 'password'}
          required
          autoComplete="new-password"
          value={again}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAgain(e.target.value)}
        />
        {again && !matches ? <span className="err">The two passwords do not match.</span> : null}
      </label>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-700">
          <span className="mt-0.5 shrink-0">
            <Icon name="alert" size={16} />
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !allPassed || !matches}>
        {busy ? 'Saving…' : 'Set password and continue'}
      </button>
    </form>
  );
}
