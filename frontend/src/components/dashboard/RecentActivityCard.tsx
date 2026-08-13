'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-1 — Last-5 activity feed.
//
// Items render as a single line each — a relative timestamp ("2h
// ago") and the friendly event message resolved from the i18n key
// the backend ships in `message.key`. The backend uses the new
// `eventType` column when available and falls back to deriving the
// type from the legacy `action` column for older rows.

export interface ActivityItem {
  type: string;
  timestamp: string;
  message: {
    key: string;
    args: Record<string, string>;
  };
  entityRef?: string;
}

export function RecentActivityCard({ activity }: { activity: ActivityItem[] }) {
  const t = useTranslations();

  // PR-ACTIVITY-LABELS — turn the server's stable keys into words.
  //
  // The server sends `subject: 'application' | 'document' | …` and a raw case
  // status. It used to send the Prisma class name and the row's cuid, which
  // rendered as "You saved AdmissionApplication" / "You recorded cms9kh22…".
  // Both are resolved here so Persian gets them from the same bundles.
  const resolveArgs = (args: Record<string, string>) => {
    const subjectKey = args.subject || 'record';
    const subjectPath = `dashboard.activity.subject.${subjectKey}`;
    const statusPath = `dashboard.caseStatus.${args.status}.label`;
    return {
      ...args,
      subject: t.has(subjectPath as Parameters<typeof t.has>[0])
        ? t(subjectPath as Parameters<typeof t>[0])
        : t('dashboard.activity.subject.record'),
      // Reuse the caseStatus map the dashboard already owns; an unmapped status
      // falls back to its own text rather than rendering "undefined".
      status: args.status && t.has(statusPath as Parameters<typeof t.has>[0])
        ? t(statusPath as Parameters<typeof t>[0])
        : args.status,
    };
  };
  return (
    <Card className="bg-white animate-fade-in-up md:col-span-2">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-[#1e3a5f]">
          <Clock size={20} />
        </div>
        <CardTitle>{t('dashboard.activity.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">{t('dashboard.activity.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {activity.map((a, i) => (
              <li key={`${a.timestamp}-${i}`} className="flex items-center justify-between gap-3 py-3">
                <p className="text-sm text-slate-800">
                  {t(a.message.key as Parameters<typeof t>[0], resolveArgs(a.message.args))}
                </p>
                <span className="whitespace-nowrap text-xs text-slate-500">
                  {formatRelativeTime(a.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
