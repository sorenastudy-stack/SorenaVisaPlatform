'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Suspense } from 'react';

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

const ROLE_REDIRECT: Record<string, string> = {
  SUPER_ADMIN: '/admin',
  ADMIN:       '/admin',
  OPERATIONS:  '/ops',
  SALES:       '/sales',
  LIA:         '/lia',
  SUPPORT:     '/student',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState('');

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
