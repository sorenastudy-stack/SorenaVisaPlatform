import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface StudentHeaderProps {
  name: string;
  photoUrl?: string | null;
  subtitle?: string;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function StudentHeader({
  name,
  photoUrl,
  subtitle,
  showBack = false,
  rightSlot,
}: StudentHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
      <div className="flex items-center gap-4 min-w-0">
        {showBack && (
          <Link
            href="/student"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-[#1E3A5F]/15 text-[#1E3A5F]/70 hover:bg-[#FAF8F3] hover:text-[#1E3A5F] transition-colors flex-shrink-0"
            aria-label="Back to Dashboard"
          >
            <ArrowLeft size={18} />
          </Link>
        )}
        <div className="relative flex-shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={name}
              className="w-14 h-14 rounded-full object-cover border-2 border-[#E8B923]/40 shadow-sm"
            />
          ) : (
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-base font-bold bg-[#1E3A5F] text-white border-2 border-[#E8B923]/40 shadow-sm">
              {getInitials(name) || '?'}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] truncate">{name}</h1>
          {subtitle && (
            <p className="text-sm text-[#4A4A4A]/70 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
    </div>
  );
}
