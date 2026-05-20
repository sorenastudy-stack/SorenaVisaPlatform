'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

// PR-DASH-4 — Dashboard card.
//
// Replaces the PR-DASH-1 "Ask Sorena — coming soon" placeholder.
// Pure link card — no live data; tapping it opens the chat at
// /student/chat.
export function ChatbotCard() {
  const t = useTranslations();
  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-sorena-navy">
          <MessageCircle size={20} />
        </div>
        <CardTitle>{t('chat.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          {t('chat.empty.subtitle')}
        </p>
        <Link
          href="/student/chat"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-navy px-6 text-base font-semibold text-white transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
        >
          {t('chat.title')}
        </Link>
      </CardContent>
    </Card>
  );
}
