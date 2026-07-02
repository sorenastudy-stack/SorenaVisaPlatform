import { redirect } from 'next/navigation';

// PR-CLIENT-CASE — the real "My Case" page lives at /portal/case (stage,
// what-to-do-next, timeline, team + contact). This was a "coming soon" stub;
// redirect students to the real page rather than maintain a duplicate.
// (Consolidating the /portal and /student client portals is tracked separately.)
export default function StudentCasePage() {
  redirect('/portal/case');
}
