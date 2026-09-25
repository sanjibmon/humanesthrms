import { LoginForm } from '@/components/auth-forms';

/* The production prompt is explicit: no role names anywhere on the login page.
   Super Admin, Admin, Support, Finance and Sales are resolved after MFA. */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-8">
      <LoginForm
        title="Sign in"
        subtitle="Access your admin dashboard"
        emailPlaceholder="Enter your email"
      />
    </div>
  );
}
