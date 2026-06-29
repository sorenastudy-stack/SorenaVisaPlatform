// Client portal loading state. Shown while /portal/* server components
// render, so a slow render reads as "Loading…" rather than a frozen
// previous page.

export default function PortalLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#faf8f3] px-4">
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  );
}
