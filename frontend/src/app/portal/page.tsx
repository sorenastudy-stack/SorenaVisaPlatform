import { redirect } from 'next/navigation';

// Client portal step 3 — /portal lands on /portal/case.
export default function PortalIndex() {
  redirect('/portal/case');
}
