'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ShieldOff } from 'lucide-react';

export default function UnauthorizedPage() {
  const router = useRouter();

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-cream px-4">
      <div className="text-center max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-sorena-navy/10 flex items-center justify-center">
            <ShieldOff size={32} className="text-sorena-navy" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-sorena-navy mb-2">
          Access Restricted
        </h1>
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          You don&apos;t have access to this area. Please contact your administrator if you
          believe this is a mistake.
        </p>
        <Button variant="primary" size="md" onClick={handleSignOut}>
          Sign out and try again
        </Button>
      </div>
    </div>
  );
}
