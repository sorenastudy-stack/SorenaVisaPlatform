'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// PR-CONSULT-2 — Cases list query hook.
//
// Single hook the cases-list page uses to fetch /api/staff/cases.
// Debounces the search term so the user doesn't fire one request
// per keystroke. Other filters (status, assignedToMe, page) trigger
// an immediate fetch.
//
// `items` is rendered to the table / grid; `total` drives the
// pagination control.

export interface CaseRowApi {
  id:                 string;
  studentId:          string;
  studentName:        string;
  studentEmail:       string;
  status:             string;
  stage:              string;
  createdAt:          string;
  updatedAt:          string;
  assignedLia:        { id: string; name: string } | null;
  assignedConsultant: { id: string; name: string } | null;
}

interface ListResponse {
  items:    CaseRowApi[];
  total:    number;
  page:     number;
  pageSize: number;
}

export interface CasesQuery {
  q?:            string;
  status?:       string;
  assignedToMe?: boolean;
  // PR-OPS-CASES: when true, restrict to active cases (stage not
  // COMPLETED/WITHDRAWN). Used by the OPS cases page.
  activeOnly?:   boolean;
  page?:         number;
  pageSize?:     number;
}

export function useCasesQuery(query: CasesQuery) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  // Debounce the search term — empty / whitespace-only search clears
  // immediately so users get the unfiltered list back without lag.
  const [debouncedQ, setDebouncedQ] = useState(query.q ?? '');
  useEffect(() => {
    const term = (query.q ?? '').trim();
    if (term.length === 0) {
      setDebouncedQ('');
      return;
    }
    const handle = setTimeout(() => setDebouncedQ(term), 300);
    return () => clearTimeout(handle);
  }, [query.q]);

  useEffect(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (debouncedQ) params.set('q', debouncedQ);
    if (query.status) params.set('status', query.status);
    if (query.assignedToMe) params.set('assignedToMe', 'true');
    if (query.activeOnly) params.set('activeOnly', 'true');
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));

    api.get<ListResponse>(`/api/staff/cases?${params.toString()}`)
      .then((res) => {
        if (seq === seqRef.current) setData(res);
      })
      .catch((err) => {
        if (seq === seqRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load cases');
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [debouncedQ, query.status, query.assignedToMe, query.activeOnly, query.page, query.pageSize]);

  return { data, loading, error };
}
