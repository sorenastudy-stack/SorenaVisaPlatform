'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, X, AlertTriangle } from 'lucide-react';

// PR-CONSULT-3 — Temporary-password reveal modal.
//
// Shown once after OWNER creates a staff user. The password is
// returned by the backend in plaintext and must be saved before
// the user closes this modal — backend has no other way to
// surface it (no email wiring yet, password is bcrypted after).
// Manual close only (no auto-dismiss) so it can't be lost to a
// click outside the modal.

export function TempPasswordModal({
  password,
  onDone,
}: {
  password: string;
  onDone:   () => void;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can be blocked (e.g. http context). The
      // password is still visible in the textarea so the user can
      // select + copy by hand.
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle size={18} className="text-amber-700" />
            </div>
            <h2 className="text-lg font-bold text-[#1e3a5f]">
              {t('staff.users.passwordModal.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {t('staff.users.passwordModal.body')}
        </p>

        <div className="mb-4">
          <textarea
            value={password}
            readOnly
            rows={2}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm font-mono break-all resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/30 text-[#1e3a5f] font-semibold px-4 py-3 hover:bg-[#1e3a5f]/5 transition-colors min-h-[48px]"
          >
            <Copy size={16} />
            {copied ? t('staff.users.passwordModal.copied') : t('staff.users.passwordModal.copy')}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="flex-1 rounded-xl bg-[#1e3a5f] text-white font-semibold px-4 py-3 hover:bg-[#162d4a] transition-colors min-h-[48px]"
          >
            {t('staff.users.passwordModal.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
