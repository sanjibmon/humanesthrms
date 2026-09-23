import Link from 'next/link';
import { LoginForm } from '@/components/auth-forms';

/* No role names on the login page itself: the employer and employee entry points
   differ only in wording, and permissions are resolved after MFA. */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const employee = searchParams.as === 'employee';
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-8">
      <LoginForm
        title={employee ? 'Employee Login' : 'Employer Login'}
        subtitle={
          employee ? 'Access your self-service portal' : 'Sign in to manage your organization'
        }
        emailPlaceholder="Enter your work email"
      />
      <Link href="/" className="btn h-8 text-xs text-brand-dark">
        Back to login options
      </Link>
    </div>
  );
}
