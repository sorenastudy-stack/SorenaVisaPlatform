import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';

// PR-CONSULT-2 — Staff Overview placeholder.
//
// The real overview (active workload, queues, recent activity per
// role) lands in a later PR. For now the page exists so post-login
// routing has somewhere to land and the shell renders.
export default function StaffOverviewPage() {
  return <PlaceholderPanel section="Overview" />;
}
