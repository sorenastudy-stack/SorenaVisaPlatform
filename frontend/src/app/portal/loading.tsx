import { SorenaGlobeLoader } from '@/components/loader/SorenaGlobeLoader';

// Client portal loading state — shown while /portal/* server components render.
// PR-GLOBE-LOADER: the "Global Operations · Live" globe. It's a hook-free
// presentational component, so this Suspense fallback ships no client JS.
export default function PortalLoading() {
  return <SorenaGlobeLoader />;
}
