import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandLockup } from '@/components/brand';
import { SetPasswordForm } from '@/components/set-password-form';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SetPasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reached without a valid invitation link, or the link had already been used.
  if (!user) redirect('/login?error=That+invitation+link+has+expired.+Ask+for+a+new+one.');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 py-12">
      <BrandLockup />
      <div className="w-full max-w-[420px] rounded-2xl border border-slate-line bg-white p-6 shadow-sm sm:p-7">
        <h1 className="text-lg">Choose your password</h1>
        <p className="mb-5 mt-1 text-[13px] text-slate-muted">
          One-time setup for your HumaNest account
        </p>
        <SetPasswordForm email={user.email ?? ''} />
      </div>
      <Link href="/login" className="text-xs text-slate-muted hover:text-brand-dark">
        Back to sign in
      </Link>
    </main>
  );
}
