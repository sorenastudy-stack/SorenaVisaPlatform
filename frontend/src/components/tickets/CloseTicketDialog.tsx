'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

// PR-DASH-2 — Close-ticket confirmation modal.
//
// The project doesn't ship a shadcn/ui Dialog primitive — admin uses
// an inline fixed-position overlay for its modals. We follow that
// pattern here: a click-outside dismissable backdrop, ESC to close,
// focus-trap kept minimal (the confirm button is autofocused).
export function CloseTicketDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!busy) onCancel(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-sorena-navy">
          {t('tickets.detail.closeConfirm.title')}
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          {t('tickets.detail.closeConfirm.body')}
        </p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            {t('tickets.detail.closeConfirm.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="inline-flex h-12 items-center justify-center rounded-xl bg-rose-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
          >
            {t('tickets.detail.closeConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
