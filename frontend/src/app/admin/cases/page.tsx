import { redirect } from 'next/navigation';

// The cross-case view lives in the OPS portal (/ops/cases). This was a
// "coming soon" stub duplicating it; forward rather than maintain a duplicate.
export default function AdminCasesPage() {
  redirect('/ops/cases');
}
