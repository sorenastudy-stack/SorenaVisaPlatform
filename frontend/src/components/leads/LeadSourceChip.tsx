// PR-CRM-LEADS — Source chip for a lead.
//
// `sourceChannel` is a free-text column on Lead (no enum), so the
// chip normalises a handful of known values and falls through to a
// generic "Other" badge for everything else.

const KNOWN_PATTERNS: Array<{
  test: (s: string) => boolean;
  label: string;
  className: string;
}> = [
  {
    test: (s) => /^scorecard$/i.test(s) || /scorecard/i.test(s),
    label: 'Scorecard',
    className: 'bg-[#1E3A5F] text-white border-[#1E3A5F]',
  },
  {
    test: (s) => /^wix/i.test(s),
    label: 'Wix',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  {
    test: (s) => /manual/i.test(s),
    label: 'Manual',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  {
    test: (s) => /whatsapp/i.test(s),
    label: 'WhatsApp',
    className: 'bg-lime-100 text-lime-800 border-lime-200',
  },
  {
    test: (s) => /referral|affiliate/i.test(s),
    label: 'Referral',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
  },
];

export function LeadSourceChip({ source, compact = false }: {
  source: string | null;
  compact?: boolean;
}) {
  if (!source) {
    return (
      <span className={[
        'inline-flex items-center font-semibold rounded-full border bg-gray-50 text-gray-500 border-gray-200',
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
      ].join(' ')}>
        Unknown
      </span>
    );
  }

  const matched = KNOWN_PATTERNS.find((p) => p.test(source));
  const label = matched?.label ?? source;
  const className = matched?.className ?? 'bg-amber-50 text-amber-800 border-amber-200';

  return (
    <span className={[
      'inline-flex items-center font-semibold rounded-full border',
      compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
      className,
    ].join(' ')}>
      {label}
    </span>
  );
}

export const COMMON_LEAD_SOURCES = [
  'SCORECARD',
  'WIX_LEAD_CAPTURE',
  'MANUAL',
  'WHATSAPP',
  'REFERRAL',
] as const;
