'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ASSIGNABLE_ROLES } from './types';

// OWNER-only inline section for a staff user's SECONDARY roles.
//
// Secondary roles WIDEN access only — they NEVER change the primary `role`
// (badge, routing, and where the user lands after login are unchanged).
// Multi-select checkboxes of every assignable role except the user's primary
// role; Save PATCHes /api/staff/users/:id/secondary-roles. The server also
// enforces OWNER-only + no-self-grant + whitelist + audit — this UI is gated to
// OWNER by the parent, but the server is the source of truth.
export function SecondaryRolesSection({
  userId,
  primaryRole,
  initial,
  onDone,
}: {
  userId:      string;
  primaryRole: string;
  initial:     string[];
  onDone:      () => void;
}) {
  const t = useTranslations();
  const options = ASSIGNABLE_ROLES.filter((r) => r !== primaryRole);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [saving, setSaving] = useState(false);

  const toggle = (r: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  // Enable Save only when the selection differs from what's persisted.
  const dirty = options.some((r) => selected.has(r) !== initial.includes(r));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/staff/users/${userId}/secondary-roles`, {
        secondaryRoles: Array.from(selected),
      });
      toast.success('Secondary roles updated');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update secondary roles');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 p-4 mb-5">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
        Secondary roles
      </h3>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        Widen this user&apos;s access without changing their primary role. Their badge and where
        they land after signing in stay the same.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {options.map((r) => {
          const checked = selected.has(r);
          return (
            <label
              key={r}
              className={[
                'flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors min-h-[48px]',
                checked
                  ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                  : 'border-gray-200 hover:border-[#1e3a5f]/40',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(r)}
                className="h-4 w-4 rounded accent-[#1e3a5f]"
              />
              <span className="text-sm font-medium text-[#1e3a5f]">{t(`staff.roles.${r}`)}</span>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
      >
        {saving ? '…' : 'Save secondary roles'}
      </button>
    </section>
  );
}
