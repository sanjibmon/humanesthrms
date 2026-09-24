import { BrandLockup } from '@/components/brand';
import { AuthCallback } from '@/components/auth-callback';

export const dynamic = 'force-dynamic';

export default function CallbackPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 py-12">
      <BrandLockup />
      <div className="w-full max-w-[420px] rounded-2xl border border-slate-line bg-white p-6 shadow-sm sm:p-7">
        <AuthCallback />
      </div>
    </main>
  );
}
