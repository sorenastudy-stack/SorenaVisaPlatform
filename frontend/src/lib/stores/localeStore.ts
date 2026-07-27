import { create } from 'zustand';

type Locale = 'en' | 'fa';

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

// PR-I18N-1 — persist the choice in the `NEXT_LOCALE` cookie (client-side) so it
// survives reloads AND is readable server-side by i18n/request.ts (getTranslations)
// and the root layout (which sets <html lang dir>). The store is seeded from the
// server-resolved locale by LocaleProvider, so SSR and hydration agree.
const ONE_YEAR = 60 * 60 * 24 * 365;
function writeCookie(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }
}

export const useLocaleStore = create<LocaleStore>((set, get) => ({
  locale: 'en',
  setLocale: (locale) => { writeCookie(locale); set({ locale }); },
  toggleLocale: () => {
    const next: Locale = get().locale === 'en' ? 'fa' : 'en';
    writeCookie(next);
    set({ locale: next });
  },
}));
