'use client';

import { useTranslations } from 'next-intl';
import { Ticket, Video, MessageCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

// PR-DASH-1 — Disabled "coming soon" cards.
//
// PR-DASH-2 (Support tickets), PR-DASH-3 (Meetings & transcripts),
// and PR-DASH-4 (Ask Sorena chatbot) will activate these placeholders.
// Same visual style as the real cards but greyed out, with a
// "Coming soon" badge so the layout doesn't change shape when they
// land.

function Placeholder({
  titleKey,
  bodyKey,
  icon,
}: {
  titleKey: string;
  bodyKey: string;
  icon: React.ReactNode;
}) {
  const t = useTranslations();
  return (
    <Card className="bg-white opacity-60 animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-500">{icon}</div>
        <CardTitle>{t(titleKey as Parameters<typeof t>[0])}</CardTitle>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {t('dashboard.assessmentReport.comingSoon')}
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600">
          {t(bodyKey as Parameters<typeof t>[0])}
        </p>
      </CardContent>
    </Card>
  );
}

export function TicketsPlaceholderCard() {
  return (
    <Placeholder
      titleKey="dashboard.tickets.placeholder.title"
      bodyKey="dashboard.tickets.placeholder.body"
      icon={<Ticket size={20} />}
    />
  );
}

export function MeetingsPlaceholderCard() {
  return (
    <Placeholder
      titleKey="dashboard.meetings.placeholder.title"
      bodyKey="dashboard.meetings.placeholder.body"
      icon={<Video size={20} />}
    />
  );
}

export function ChatbotPlaceholderCard() {
  return (
    <Placeholder
      titleKey="dashboard.chatbot.placeholder.title"
      bodyKey="dashboard.chatbot.placeholder.body"
      icon={<MessageCircle size={20} />}
    />
  );
}
