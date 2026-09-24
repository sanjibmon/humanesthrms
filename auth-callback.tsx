'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/icon';

/**
 * Where every emailed link lands: invitations, email confirmations, magic links
 * and password recovery.
 *
 * This runs in the browser on purpose. Supabase hands the session back in one of
 * three shapes depending on the flow and the email template, and only a browser
 * can see all three:
 *
 *   1. `?code=…`                      PKCE — exchange it for a session.
 *   2. `?token_hash=…&type=…`         the template used {{ .TokenHash }}.
 *   3. `#access_token=…&refresh_token=…`
 *      The default template sends people through /auth/v1/verify, which puts
 *      the session in the URL *fragment*. A fragment is never transmitted to
 *      the server, so a route handler sees an empty query string and can only
 *      report that the link is broken — while the token has already been spent.
 *      That is the failure this page exists to prevent.
 */
export function AuthCallback() {
  const router = useRouter();
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

      const next = params.get('next') ?? '/auth/set-password';
      const code = params.get('code');
      const tokenHash = params.get('token_hash');
      const type = params.get('type') ?? 'invite';
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      // Supabase reports link problems in the fragment too.
      const hashError = hash.get('error_description') ?? hash.get('error');
      const queryError = params.get('error_description') ?? params.get('error');

      try {
        if (accessToken && refreshToken) {
          const { error: e } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (e) throw e;
        } else if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          if (e) throw e;
        } else if (tokenHash) {
          const { error: e } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (e) throw e;
        } else if (hashError || queryError) {
          throw new Error(hashError ?? queryError ?? 'That link is no longer valid.');
        } else {
          throw new Error(
            'That link is missing its token. It may have already been used — ask for a fresh invitation.',
          );
        }

        // Clear the token out of the address bar before moving on.
        window.history.replaceState({}, '', window.location.pathname);
        router.replace(next);
        router.refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'That link could not be verified.');
      }
    })();
  }, [router]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-700">
          <span className="mt-0.5 shrink-0">
            <Icon name="alert" size={16} />
          </span>
          <span>{error}</span>
        </div>
        <a href="/login" className="btn btn-primary btn-block">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <p className="flex items-center justify-center gap-2.5 py-6 text-[13px] text-slate-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-line border-t-brand" />
      Verifying your link…
    </p>
  );
}
