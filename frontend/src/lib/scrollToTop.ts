// Centralized scroll-to-top helper. Targets the portal's <main>
// scrollable container (the student/staff/lia portal layouts wrap
// content in <main className="... overflow-y-auto"> — window.scrollTo
// is a no-op because the body itself doesn't scroll).
//
// Used by multi-step forms (visa, admission) on step transition to
// land the user at the top of the next step instead of mid-page.
export function scrollPortalToTop(): void {
  if (typeof document === 'undefined') return; // SSR guard
  const main = document.querySelector('main');
  if (!main) return;
  main.scrollTo({ top: 0, behavior: 'smooth' });
}
