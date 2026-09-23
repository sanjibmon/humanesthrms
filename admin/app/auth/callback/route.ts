import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Where every emailed link lands: invitations, email confirmations, magic links
 * and password recovery. Supabase sends either a PKCE `code` or a `token_hash`
 * plus `type`, depending on the template, so both are handled.
 *
 * On success the user has a session but no password of their own, so they are
 * sent to /auth/set-password. From there the middleware takes over and forces
 * authenticator enrolment before any protected route opens.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') ?? 'invite';
  const next = url.searchParams.get('next') ?? '/auth/set-password';

  const supabase = createClient();
  let message: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    message = error?.message ?? null;
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    message = error?.message ?? null;
  } else {
    message = 'That link is missing its token. Ask for a fresh invitation.';
  }

  const dest = url.clone();
  dest.searchParams.delete('code');
  dest.searchParams.delete('token_hash');
  dest.searchParams.delete('type');

  if (message) {
    dest.pathname = '/login';
    dest.searchParams.set('error', message);
    return NextResponse.redirect(dest);
  }

  dest.pathname = next;
  dest.searchParams.delete('next');
  return NextResponse.redirect(dest);
}
