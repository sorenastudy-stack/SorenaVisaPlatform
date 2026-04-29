import { create } from 'zustand';

type Locale = 'en' | 'fa';

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const useLocaleStore = create<LocaleStore>((set, get) => ({
  locale: 'en',
  setLocale: (locale) => set({ locale }),
  toggleLocale: () => set({ locale: get().locale === 'en' ? 'fa' : 'en' }),
}));
