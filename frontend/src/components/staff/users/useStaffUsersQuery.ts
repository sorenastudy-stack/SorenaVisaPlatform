'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { StaffUserRow } from './types';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — Staff users list hook.
// PR-CONSULT-4 — extended with the `archived` filter (default
// `false`, i.e. show active only). Filter is server-side via
// ?archived=…; q and role still filter client-side because staff
// counts are small and we don't want to fire a request per
// keystroke.

interface Filters {
  q?:        string;
  role?:     StaffRole | '';
  archived?: 'false' | 'true' | 'all';
}

export function useStaffUsersQuery(filters: Filters) {
  const [rows, setRows] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const archived = filters.archived ?? 'false';

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<StaffUserRow[]>(`/api/staff/users?archived=${archived}`);
      if (seq === seqRef.current) setRows(data);
    } catch (err) {
      if (seq === seqRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load staff');
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [archived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounce the search term — empty / whitespace-only resets at once.
  const [debouncedQ, setDebouncedQ] = useState(filters.q ?? '');
  useEffect(() => {
    const term = (filters.q ?? '').trim();
    if (term.length === 0) {
      setDebouncedQ('');
      return;
    }
    const handle = setTimeout(() => setDebouncedQ(term), 300);
    return () => clearTimeout(handle);
  }, [filters.q]);

  const filtered = useMemo(() => {
    return rows.filter((u) => {
      if (filters.role && u.role !== filters.role) return false;
      if (debouncedQ) {
        const term = debouncedQ.toLowerCase();
        if (!u.name.toLowerCase().includes(term)
            && !u.email.toLowerCase().includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, debouncedQ, filters.role]);

  return { rows: filtered, loading, error, refresh };
}
