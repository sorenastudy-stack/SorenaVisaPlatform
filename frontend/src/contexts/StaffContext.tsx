'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';

// PR-CONSULT-2 — Staff context.
//
// Fetches /api/staff/me on mount and exposes the snapshot to every
// component under the /staff layout. Components use the `permissions`
// object to gate nav items + action buttons; the role badge in the
// top bar reads `me.role`.
//
// The context starts in a loading state with `me === null`; consumers
// either tolerate that (rendering a skeleton) or check `loading`. The
// `refresh` callback re-fetches — useful after an admin reassigns
// themselves into / out of a slot.

export type StaffRole =
  | 'OWNER' | 'SUPER_ADMIN' | 'ADMIN'
  | 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE';

export interface StaffPermissions {
  canManageStaff:   boolean;
  canApprove:       boolean;
  // PR-CONSULT-3: SUPER_ADMIN + OWNER can view the Approvals page
  // (OWNER for Pending, SUPER_ADMIN for Mine). Distinct from
  // canApprove which gates the Approve/Reject buttons themselves.
  canViewApprovals: boolean;
  canSeeAllCases:   boolean;
  canReassign:      boolean;
}

export interface StaffMe {
  id:          string;
  email:       string;
  fullName:    string;
  role:        StaffRole;
  isActive:    boolean;
  permissions: StaffPermissions;
}

interface StaffContextValue {
  me:          StaffMe | null;
  permissions: StaffPermissions;
  loading:     boolean;
  error:       string | null;
  refresh:     () => Promise<void>;
}

const DEFAULT_PERMISSIONS: StaffPermissions = {
  canManageStaff:   false,
  canApprove:       false,
  canViewApprovals: false,
  canSeeAllCases:   false,
  canReassign:      false,
};

const StaffContext = createContext<StaffContextValue>({
  me:          null,
  permissions: DEFAULT_PERMISSIONS,
  loading:     true,
  error:       null,
  refresh:     async () => {},
});

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<StaffMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<StaffMe>('/api/staff/me');
      setMe(data);
    } catch (err) {
      setMe(null);
      setError(err instanceof Error ? err.message : 'Failed to load staff profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const value = useMemo<StaffContextValue>(() => ({
    me,
    permissions: me?.permissions ?? DEFAULT_PERMISSIONS,
    loading,
    error,
    refresh: fetchMe,
  }), [me, loading, error, fetchMe]);

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  return useContext(StaffContext);
}
