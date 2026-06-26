import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// PR-LIA-5 — Subtle "back to <somewhere>" link rendered above each
// page's title. Lives on the individual pages (not in PortalLayout)
// so each page can name its own destination.

export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] mb-4 ${className ?? ''}`}
    >
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}
