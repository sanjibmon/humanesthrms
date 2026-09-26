'use server';

import { cookies } from 'next/headers';

/**
 * Remembers whether a dual-role person is looking at the employer side or their
 * own self service.
 *
 * It is only a preference, never a permission: every page still reads the real
 * role and the real employee link, and row level security does not know this
 * cookie exists. Forging it gets somebody a different menu and nothing else —
 * an employee who sets it to 'employer' sees employer links that all refuse
 * them, because the database is where access actually lives.
 */
export async function setView(view: 'employer' | 'employee'): Promise<void> {
  cookies().set('humanest-view', view === 'employee' ? 'employee' : 'employer', {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}
