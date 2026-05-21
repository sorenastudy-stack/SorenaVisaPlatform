'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Globe } from 'lucide-react';
import { useStaff } from '@/contexts/StaffContext';
import { useLocaleStore } from '@/lib/stores/localeStore';
import { invalidateTokenCache } from '@/lib/api';
import { StaffRoleBadge } from './StaffRoleBadge';

// PR-CONSULT-2 — Staff top bar.
//
// Always visible (desktop + mobile). Shows the user's name, role
// badge, locale toggle, and sign-out button. Sign-out clears the
// http-only cookie via /api/auth/logout and resets the cached JWT
// before redirecting to /login.

export function StaffTopBar() {
  const router = useRouter();
  const t = useTranslations();
  const { me, loading } = useStaff();
  const { locale, toggleLocale } = useLocaleStore();

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore — we're about to redirect anyway.
    }
    invalidateTokenCache();
    router.push('/login');
  };

  return (
    <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-gray-100 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-semibold text-[#1e3a5f] hidden sm:block truncate">
          {loading ? '…' : (me?.fullName ?? '')}
        </span>
        {me?.role && <StaffRoleBadge role={me.role} />}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleLocale}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors min-h-[36px]"
          title={locale === 'en' ? 'Switch to Persian' : 'Switch to English'}
        >
          <Globe size={14} />
          {locale === 'en' ? 'فا' : 'EN'}
        </button>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors min-h-[36px]"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">{t('staff.signOut')}</span>
        </button>
      </div>
    </header>
  );
}
