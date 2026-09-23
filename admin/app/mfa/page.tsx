import { MfaForm } from '@/components/auth-forms';

export default function MfaPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-8">
      <MfaForm home="/dashboard" />
    </div>
  );
}
