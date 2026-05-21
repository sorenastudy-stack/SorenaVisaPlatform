'use client';

import { useStaff, type StaffPermissions } from '@/contexts/StaffContext';

// PR-CONSULT-2 — Permission gate.
//
// <PermissionGate require="canManageStaff">...</PermissionGate>
// Renders children when the permission is true, null otherwise.
// Reads from StaffContext so consumers don't have to thread the
// permissions object down themselves.

export function PermissionGate({
  require,
  children,
  fallback = null,
}: {
  require:    keyof StaffPermissions;
  children:   React.ReactNode;
  fallback?:  React.ReactNode;
}) {
  const { permissions } = useStaff();
  if (!permissions[require]) return <>{fallback}</>;
  return <>{children}</>;
}
