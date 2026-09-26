'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setView } from '@/app/actions/view';

/**
 * Shown only to somebody who is both an employer user and an employee of the
 * same company — an owner who is also on the payroll, an HR admin who takes
 * leave like everybody else.
 *
 * One login, two contexts. Switching rewrites the menu and sends them to the
 * home of whichever side they chose. The choice is a cookie rather than a
 * client-side toggle, so the server renders the right menu on the first paint
 * instead of flashing the wrong one and correcting itself.
 */
export function ViewSwitch({ view }: { view: 'employer' | 'employee' }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const go = (next: 'employer' | 'employee') => {
    if (next === view || pending) return;
    start(async () => {
      await setView(next);
      router.push(next === 'employer' ? '/dashboard' : '/me/profile');
      router.refresh();
    });
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-slate-line2 p-0.5"
      role="group"
      aria-label="Switch between employer and self service"
    >
      {(['employer', 'employee'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          disabled={pending}
          onClick={() => go(v)}
          className={`rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition ${
            view === v ? 'bg-white text-ink shadow-sm' : 'text-slate-muted hover:text-ink'
          }`}
        >
          {v === 'employer' ? 'Employer' : 'My self service'}
        </button>
      ))}
    </div>
  );
}
