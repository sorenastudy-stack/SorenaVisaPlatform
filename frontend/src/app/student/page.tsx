import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StudentHeader } from '@/components/student/StudentHeader';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';
import { relativeTime } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import {
  FileText, MessageCircle, CreditCard, ArrowRight,
  CheckCircle, Clock, AlertCircle, Folder
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContactProfile {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  preferredLanguage: string;
  photoUrl?: string | null;
  user?: { id: string; email: string; name: string; role: string };
  leads?: Array<{ id: string; leadStatus: string; scoreBand: string | null }>;
}

interface CaseData {
  id: string;
  stage: string;
  status: string;
  leadId: string;
  createdAt: string;
  updatedAt: string;
  lead?: {
    leadStatus: string;
    contact?: { fullName: string };
  };
}

interface TicketMessage {
  body: string;
  createdAt: string;
  sender?: { name: string | null; email: string };
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  updatedAt: string;
  messages?: TicketMessage[];
}

interface Payment {
  id: string;
  amount: string | number;
  status: string;
  currency: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  description: string;
  amount: string | number;
  currency: string;
  status: string;
  dueDate: string | null;
  payments?: Payment[];
}

const KNOWN_STAGES = new Set(['ADMISSION', 'VISA', 'INZ_SUBMITTED', 'COMPLETED', 'WITHDRAWN', 'ONBOARDING', 'ACTIVE']);
const SUBLINE_STAGES = new Set(['ADMISSION', 'VISA', 'ONBOARDING', 'COMPLETED', 'ACTIVE']);

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function StudentDashboard() {
  const t = await getTranslations('studentHome');
  const locale = (await getLocale()) as 'en' | 'fa';
  // Persian stage names come from the dictionary; unknown enums fall back to a
  // de-underscored label. Sublines map to their stage, else a warm fallback.
  const stageName = (s: string) => (KNOWN_STAGES.has(s) ? t(`stages.${s}`) : s.replace(/_/g, ' '));
  const subline = (s: string) => t(`subline.${SUBLINE_STAGES.has(s) ? s : 'fallback'}`);

  // Fetch all data server-side, fail gracefully
  let profile: ContactProfile | null = null;
  let profileError = false;

  try {
    profile = await apiServer.get<ContactProfile>('/students/me');
  } catch (err) {
    if (err instanceof ApiServerError && (err.statusCode === 403 || err.statusCode === 401)) {
      profileError = true;
    }
    if (err instanceof ApiServerError && err.statusCode === 404) {
      profileError = true;
    }
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle size={40} className="text-[#b28f4e] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#1E3A5F] mb-2">{t('wrongPortal.title')}</h2>
          <p className="text-[#4A4A4A] mb-6">{t('wrongPortal.body')}</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#c9a961] text-[#1E3A5F] font-semibold hover:bg-[#b28f4e] transition-colors"
          >
            {t('wrongPortal.back')}
          </Link>
        </div>
      </div>
    );
  }

  let caseData: CaseData | null = null;
  let tickets: Ticket[] = [];
  let invoices: Invoice[] = [];

  const [caseResult, ticketsResult, invoicesResult] = await Promise.allSettled([
    apiServer.get<CaseData>('/students/me/case'),
    apiServer.get<Ticket[]>('/students/me/tickets'),
    apiServer.get<Invoice[]>('/students/me/invoices'),
  ]);

  if (caseResult.status === 'fulfilled' && caseResult.value) caseData = caseResult.value as CaseData;
  if (ticketsResult.status === 'fulfilled' && Array.isArray(ticketsResult.value)) tickets = ticketsResult.value as Ticket[];
  if (invoicesResult.status === 'fulfilled' && Array.isArray(invoicesResult.value)) invoices = invoicesResult.value as Invoice[];

  const outstandingInvoice =
    invoices.find((inv) => ['SENT', 'OVERDUE'].includes(inv.status)) ?? null;
  const latestTicket = tickets[0] ?? null;
  const latestMessage = latestTicket?.messages?.[0] ?? null;
  const newMessages = tickets.filter((t) => t.status === 'AWAITING_CLIENT').length;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <StudentHeader
        name={profile.fullName}
        photoUrl={profile.photoUrl ?? null}
        subtitle={caseData ? subline(caseData.stage) : t('settingUp')}
      />

      {/* CTA card */}
      <div className="rounded-2xl bg-[#1E3A5F] text-white p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-[#b28f4e] text-xs font-semibold uppercase tracking-wider mb-1">{t('yourCase')}</p>
          <h2 className="text-xl font-bold">
            {caseData ? t('stageLabel', { stage: stageName(caseData.stage) }) : t('caseNotAssigned')}
          </h2>
          <p className="text-white/70 text-sm mt-1">
            {caseData ? subline(caseData.stage) : t('caseWillBeAssigned')}
          </p>
        </div>
        <Link
          href="/student/case"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#c9a961] text-[#1E3A5F] font-semibold hover:bg-[#b28f4e] transition-colors whitespace-nowrap flex-shrink-0"
        >
          {t('viewMyCase')} <ArrowRight size={16} className="rtl:rotate-180" />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Documents */}
        <Link href="/student/documents" className="block">
          <Card className="hover:border-[#c9a961]/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#c9a961]/10">
                  <FileText size={20} className="text-[#b28f4e]" />
                </div>
                <div>
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">{t('visaSection')}</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">{t('uploadArea')}</p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">{t('uploadAreaSub')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Messages */}
        <Link href="/student/case/messages" className="block">
          <Card className="hover:border-[#c9a961]/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#1E3A5F]/10">
                  <MessageCircle size={20} className="text-[#1E3A5F]" />
                </div>
                <div>
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">{t('messages')}</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">
                    {newMessages > 0 ? t('messagesAwaiting', { count: newMessages }) : tickets.length > 0 ? t('messagesAllCaught') : t('messagesNone')}
                  </p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">
                    {newMessages > 0 ? t('messagesReplied') : t('messagesNeedHelp')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Payments */}
        {outstandingInvoice ? (
          <Card className="h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#c9a961]/15">
                  <CreditCard size={20} className="text-[#c9a961]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">{t('payments')}</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">
                    {formatMoney(Number(outstandingInvoice.amount), outstandingInvoice.currency)}
                  </p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">{t('outstandingBalance')}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <PayInvoiceButton invoiceId={outstandingInvoice.id} label={t('payNow')} />
                    <Link
                      href="/student/payments"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:text-[#b28f4e] transition-colors"
                    >
                      {t('history')} <ArrowRight size={12} className="rtl:rotate-180" />
                    </Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Link href="/student/payments" className="block">
            <Card className="hover:border-[#c9a961]/50 transition-colors cursor-pointer h-full">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-[#15a86b]/10">
                    <CreditCard size={20} className="text-[#15a86b]" />
                  </div>
                  <div>
                    <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">{t('payments')}</p>
                    <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">{t('allPaidUp')}</p>
                    <p className="text-xs text-[#4A4A4A]/70 mt-1">{t('noPending')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latest message */}
        <Card>
          <CardHeader>
            <CardTitle className="text-[#1E3A5F] flex items-center gap-2">
              <MessageCircle size={16} className="text-[#b28f4e]" />
              {t('latestMessage')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestTicket && latestMessage ? (
              <div>
                <p className="text-xs text-[#4A4A4A]/60 mb-1">{latestTicket.subject}</p>
                <p className="text-sm text-[#4A4A4A] line-clamp-3">{latestMessage.body.slice(0, 160)}{latestMessage.body.length > 160 ? '…' : ''}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-[#4A4A4A]/50">
                    {latestMessage.sender?.name ?? t('sorenaTeam')} · {relativeTime(latestMessage.createdAt, locale)}
                  </span>
                  <Link
                    href="/student/case/messages"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:text-[#b28f4e] transition-colors"
                  >
                    {t('viewAll')} <ArrowRight size={12} className="rtl:rotate-180" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <MessageCircle size={28} className="text-[#4A4A4A]/20 mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">{t('noMessagesYet')}</p>
                <Link
                  href="/student/case/messages"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#b28f4e] hover:underline"
                >
                  {t('sendMessage')} <ArrowRight size={14} className="rtl:rotate-180" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-[#1E3A5F] flex items-center gap-2">
              <Clock size={16} className="text-[#b28f4e]" />
              {t('recentActivity')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tickets.length > 0 ? (
              <ol className="space-y-3">
                {tickets.slice(0, 3).map((ticket) => (
                  <li key={ticket.id} className="flex items-start gap-3">
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-[#c9a961] flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-[#1E3A5F] font-medium truncate">{ticket.subject}</p>
                      <p className="text-xs text-[#4A4A4A]/60">{relativeTime(ticket.updatedAt, locale)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : caseData ? (
              <div className="text-center py-4">
                <CheckCircle size={28} className="text-[#15a86b] mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">{t('caseActive')}</p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Folder size={28} className="text-[#4A4A4A]/20 mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">{t('activityWillAppear')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
