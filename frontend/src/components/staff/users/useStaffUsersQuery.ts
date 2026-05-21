'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { StaffUserRow } from './types';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — Staff users list hook.
//
// `GET /api/staff/users` returns the full list (no pagination on
// the server — staff counts are small). We filter / search client
// side. Returning `refresh` lets the caller refetch after a
// create / change / deactivate succeeds.

interface Filters {
  q?:      string;
  role?:   StaffRole | '';
  active?: 'true' | 'false' | 'all';
}

export function useStaffUsersQuery(filters: Filters) {
  const [rows, setRows] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<StaffUserRow[]>('/api/staff/users');
      if (seq === seqRef.current) setRows(data);
    } catch (err) {
      if (seq === seqRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load staff');
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

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
      if (filters.active === 'true'  && !u.isActive) return false;
      if (filters.active === 'false' &&  u.isActive) return false;
      if (debouncedQ) {
        const term = debouncedQ.toLowerCase();
        if (!u.name.toLowerCase().includes(term)
            && !u.email.toLowerCase().includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, debouncedQ, filters.role, filters.active]);

  return { rows: filtered, loading, error, refresh };
}
