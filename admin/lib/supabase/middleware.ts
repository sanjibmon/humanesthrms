import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Refreshes the Supabase session cookie and gates the portal behind sign-in plus MFA. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/mfa') ||
    path.startsWith('/trial') ||
    path.startsWith('/auth') ||
    path.startsWith('/_next') ||
    path.startsWith('/favicon');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  /* Multi-factor is mandatory, which means two different cases both have to be
     caught here:

       1. The account already has a verified authenticator but this session is
          still at aal1 — it must step up.
       2. The account has no authenticator at all — it must enrol before going
          any further. This is the case every brand new account starts in, and
          checking `nextLevel === 'aal2'` alone misses it, because Supabase only
          sets nextLevel to aal2 once a verified factor exists.

     Requiring currentLevel to be aal2 covers both. /mfa is public, so there is
     no redirect loop, and that page enrols a factor when none exists. */
  if (user && !isPublic) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== 'aal2') {
      const url = request.nextUrl.clone();
      url.pathname = '/mfa';
      return NextResponse.redirect(url);
    }
  }

  return response;
}
