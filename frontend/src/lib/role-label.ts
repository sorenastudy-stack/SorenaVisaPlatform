'use client';

import { useTranslations } from 'next-intl';

// PR-ROLE-LABELS — the single source of truth for turning a platform role
// enum (Prisma `UserRole`) into a human display label.
//
// The canonical labels live in the i18n `staff.roles.*` map; this hook is the
// ONE entry point every user-facing surface (the role badge, assignee
// dropdowns, team chips, approval payloads, …) resolves through, so no screen
// ever renders a raw enum string ("CLIENT_CONSULTANT") or an unresolved
// "staff.roles.X" key.
//
// Any enum value without a map entry falls back to a title-cased form
// (SUPER_ADMIN → "Super Admin"), so a role added to the backend can never leak
// a raw uppercase enum to a user before its label is added to the map.

function titleCaseEnum(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function useRoleLabel(): (role: string | null | undefined) => string {
  const t = useTranslations('staff.roles');
  return (role) => {
    if (!role) return '—';
    // next-intl returns the key path ("staff.roles.LEAD") for a missing
    // message; t.has guards so that never reaches the UI.
    return t.has(role) ? t(role) : titleCaseEnum(role);
  };
}
