'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Suspense } from 'react';
import { ROLE_REDIRECT } from '@/lib/role-redirect';

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

// Backend URL for Google OAuth round-trip. Must be a full-page
// navigation (window.location.href), not a fetch — OAuth needs the
// browser to follow the Google redirect chain.
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://api.sorenavisa.com';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState('');

  // Option C step 2 — surface invite-only rejection from the backend's
  // Google OAuth callback. Reads ?error=not_authorized (set by
  // GoogleAuthGuard on failure) and renders a calm, non-technical
  // explanation.
  const oauthError = searchParams.get('error') === 'not_authorized';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sign in failed');

      const next = searchParams.get('next');
      const redirect = next || ROLE_REDIRECT[data.role as string] || '/student';
      router.push(redirect);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-navy px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-10">
          {/* Branding */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-2">
              <img
                src="/brand/logo-type-blue.jpg"
                alt="Sorena Visa"
                className="h-12 w-auto"
              />
            </div>
            <p className="mt-3 text-center text-sm text-gray-500">Staff Portal — sign in to continue</p>
          </div>

          {oauthError && (
            <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              This email isn&apos;t authorized yet. Please contact Sorena, or use the
              email and password you were given below.
            </div>
          )}

          {/* Continue with Google — top of the card so it's the
              primary path. The email/password form below remains
              the fallback for users who haven't linked Google yet. */}
          <button
            type="button"
            onClick={() => { window.location.href = `${BACKEND_URL}/auth/google`; }}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-sorena-text hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sorena-navy"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8364.859-3.0477.859-2.344 0-4.3282-1.5832-5.0359-3.7104H.957v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
              <path d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.957C.3477 6.1732 0 7.5482 0 9s.3477 2.8268.957 4.0418L3.9641 10.71z" fill="#FBBC05"/>
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.957 4.9582L3.9641 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs uppercase tracking-wide text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-sorena-text mb-1.5">
                Email address
              </label>
              <Input
                {...register('email')}
                type="email"
                placeholder="you@sorenavisa.com"
                autoComplete="email"
                className={errors.email ? 'border-red-400 focus:ring-red-400' : ''}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-sorena-text mb-1.5">
                Password
              </label>
              <Input
                {...register('password')}
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className={errors.password ? 'border-red-400 focus:ring-red-400' : ''}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {serverError}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Sorena Visa Platform — authorised staff only
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-sorena-navy" />}>
      <LoginForm />
    </Suspense>
  );
}
