// PR-STAFF-PHOTOS — shared staff avatar. Renders the profile photo when a
// (presigned) photoUrl is present, else a navy initial-circle fallback. Used
// everywhere a staff member is identified: top-right shells, users list, team,
// case assignees. Generalized from the StudentHeader image-or-initials pattern.

function getInitials(name: string): string {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function StaffAvatar({
  name,
  photoUrl,
  size = 32,
  className = '',
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const dim = { width: size, height: size };
  const ring = 'border-2 border-[#c9a961]/40';
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        style={dim}
        className={`rounded-full object-cover ${ring} ${className}`}
      />
    );
  }
  return (
    <div
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      className={`rounded-full flex items-center justify-center font-bold bg-[#1e3a5f] text-white ${ring} ${className}`}
      aria-label={name}
    >
      {getInitials(name) || '?'}
    </div>
  );
}
