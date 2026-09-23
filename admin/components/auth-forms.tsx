'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { BrandLockup } from '@/components/brand';

function ShieldNote() {
  return (
    <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-muted">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      Secured with multi-factor authentication
    </p>
  );
}

export function LoginForm({ title, subtitle, emailPlaceholder }: {
  title: string;
  subtitle: string;
  emailPlaceholder: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push('/mfa');
    router.refresh();
  }

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-slate-line bg-white p-8 shadow-lg">
      <div className="mb-5 flex justify-center">
        <BrandLockup />
      </div>
      <h1 className="text-lg">{title}</h1>
      <p className="mb-5 mt-1 text-[13px] text-slate-muted">{subtitle}</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="lbl">Email</span>
          <input type="email" required autoComplete="username" placeholder={emailPlaceholder}
                 value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="lbl">Password</span>
          <span className="relative block">
            <input type={show ? 'text' : 'password'} required autoComplete="current-password"
                   placeholder="Enter your password" className="pr-11"
                   value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-slate-muted transition hover:bg-slate-surface hover:text-brand">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {show ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <path d="M1 1l22 22" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </span>
        </label>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-muted">
            <input type="checkbox" className="h-4 w-4 accent-[#087FD9]" /> Remember me
          </label>
          <Link href="/login" className="text-xs font-medium text-brand-dark hover:underline">
            Forgot password?
          </Link>
        </div>

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{error}</p>
        ) : null}

        <button type="submit" disabled={busy} className="btn btn-primary btn-block">
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <ShieldNote />
    </div>
  );
}

const METHODS: [string, string][] = [
  ['totp', 'Authenticator App (Recommended)'],
  ['sms', 'SMS OTP'],
  ['email', 'Email OTP'],
  ['backup', 'Backup Codes'],
];

export function MfaForm({ home }: { home: string }) {
  const router = useRouter();
  const supabase = createClient();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [email, setEmail] = useState('');
  const [timer, setTimer] = useState(28);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [method, setMethod] = useState('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the account has no verified TOTP factor yet and must enrol. */
  const [enrol, setEnrol] = useState<{ factorId: string; qr: string; secret: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setEmail(user.email ?? '');
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.find((f) => f.status === 'verified');
      if (!verified) {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (error) setError(error.message);
        else if (data)
          setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timer <= 0) return;
    const h = setTimeout(() => setTimer((t) => t - 1), 1000);
    return () => clearTimeout(h);
  }, [timer]);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) boxes.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = '';
      setDigits(next);
      boxes.current[i - 1]?.focus();
    }
  }

  async function verify() {
    const code = digits.join('');
    if (code.length < 6) {
      setError('Enter all six digits');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const factorId =
        enrol?.factorId ??
        (await supabase.auth.mfa.listFactors()).data?.totp?.find((f) => f.status === 'verified')?.id;
      if (!factorId) throw new Error('No authenticator factor is available for this account');
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      if (!ch) throw new Error('Could not start a verification challenge. Try again.');
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code,
      });
      if (vErr) throw vErr;
      router.push(home);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed');
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-slate-line bg-white p-8 shadow-lg">
      <div className="mb-5 flex justify-center">
        <BrandLockup />
      </div>
      <h1 className="text-lg">Two-factor authentication</h1>
      <p className="mb-4 mt-1 text-[13px] text-slate-muted">
        {enrol
          ? 'Scan the code with Google Authenticator or Authy, then enter the six digits to finish enrolment.'
          : 'Enter the code from your authenticator app'}
      </p>

      <div className="mb-4 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-4 py-2 text-[13px] text-brand-dark">
          {email || 'you@example.co.in'}
        </span>
      </div>

      {enrol ? (
        <div className="mb-4 flex flex-col items-center gap-2 rounded-xl border border-slate-line p-4">
          {/* Supabase returns the enrolment QR as an inline SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="Authenticator enrolment QR code" width={168} height={168} />
          <code className="break-all text-[11px] text-slate-muted">{enrol.secret}</code>
        </div>
      ) : null}

      <div className="flex justify-center gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el: HTMLInputElement | null) => {
              boxes.current[i] = el;
            }}
            inputMode="numeric"
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            value={d}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDigit(i, e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => onKeyDown(i, e)}
            className="h-12 !w-12 rounded-xl border border-slate-line px-0 text-center text-xl font-bold text-ink"
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-3.5 text-xs text-slate-muted">
        <span className="tabular-nums">00:{String(Math.max(0, timer)).padStart(2, '0')}</span>
        <button type="button" onClick={() => setTimer(28)} className="font-medium text-brand-dark hover:underline">
          Resend code
        </button>
      </div>

      <div className="mt-3.5">
        <button type="button" onClick={() => setMethodsOpen((v) => !v)}
                className="btn btn-block h-9 text-brand-dark">
          Use another method
        </button>
        {methodsOpen ? (
          <div className="mt-2 flex flex-col gap-1 rounded-xl border border-slate-line p-2">
            {METHODS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setMethod(k); setMethodsOpen(false); }}
                      aria-current={method === k ? 'page' : undefined} className="nav-item text-[13px]">
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <label className="my-4 flex cursor-pointer items-center gap-2 text-xs text-slate-muted">
        <input type="checkbox" className="h-4 w-4 accent-[#087FD9]" /> Remember this device for 30 days
      </label>

      {error ? (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{error}</p>
      ) : null}

      <button type="button" onClick={verify} disabled={busy} className="btn btn-primary btn-block">
        {busy ? 'Verifying…' : 'Verify'}
      </button>

      <div className="mt-3.5 text-center">
        <button type="button"
                onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}
                className="text-xs text-slate-muted hover:underline">
          Back to login
        </button>
      </div>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();
  return (
    <button
      type="button"
      aria-label="Sign out"
      onClick={async () => {
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
      }}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-slate-muted transition hover:bg-slate-surface hover:text-brand"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </svg>
    </button>
  );
}
