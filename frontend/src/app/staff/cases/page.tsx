import { CasesPageClient } from '@/components/staff/cases/CasesPageClient';

// PR-CONSULT-2 — Cases list page.
//
// Auth + role check happens in the parent /staff layout. The page
// itself is a thin server-component wrapper around the client
// component that owns filter / pagination state and fires the
// /api/staff/cases query.
export default function StaffCasesPage() {
  return <CasesPageClient />;
}
