import Link from 'next/link';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StudentHeader } from '@/components/student/StudentHeader';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function firstName(fullName: string): string {
  return fullName?.split(' ')[0] ?? 'there';
}

function formatCurrency(amount: string | number, currency = 'NZD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  // currencyDisplay: 'code' → "USD 200.00", matching the /student/payments row.
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(num);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function stageSubline(stage: string): string {
  const map: Record<string, string> = {
    ADMISSION: "We're working on your university admission — great progress so far.",
    VISA: "Your visa application is being prepared — stay close, we may need documents.",
    ONBOARDING: "Almost there! Final onboarding steps are underway.",
    COMPLETED: "Your case is complete. Congratulations on this milestone!",
    ACTIVE: "Your case is moving forward — here's what's happening.",
  };
  return map[stage] ?? "Your case is in progress — we'll keep you updated every step of the way.";
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function StudentDashboard() {
  // Fetch all data server-side, fail gracefully
  let profile: ContactProfile | null = null;
  let profileError = false;

  try {
    profile = await apiServer.get<ContactProfile>('/students/me');
  } catch (err) {
    if (err instanceof ApiServerError && (err.statusCode === 403 || err.statusCode === 401)) {
      profileError = true;
    }
    // 404 also means no student profile
    if (err instanceof ApiServerError && err.statusCode === 404) {
      profileError = true;
    }
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle size={40} className="text-[#b8941f] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#1E3A5F] mb-2">Wrong portal</h2>
          <p className="text-[#4A4A4A] mb-6">
            This portal is for student users. If you&apos;re staff, please use the Sales or Admin portal.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F3CE49] text-[#1E3A5F] font-semibold hover:bg-[#d4a51e] transition-colors"
          >
            Back to Login
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

  const name = firstName(profile.fullName);
  // The specific payable invoice (the engagement fee, in practice) to send the
  // client to checkout for. Restricted to the statuses the pay-link endpoint
  // accepts, and used for BOTH the Pay-now button and the amount shown — in the
  // invoice's own currency (matching the /student/payments row).
  const outstandingInvoice =
    invoices.find((inv) => ['SENT', 'OVERDUE'].includes(inv.status)) ?? null;
  const latestTicket = tickets[0] ?? null;
  const latestMessage = latestTicket?.messages?.[0] ?? null;
  const newMessages = tickets.filter(t => t.status === 'AWAITING_CLIENT').length;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <StudentHeader
        name={profile.fullName}
        photoUrl={profile.photoUrl ?? null}
        subtitle={caseData ? stageSubline(caseData.stage) : "We're setting things up — your case will appear here soon."}
      />

      {/* CTA card */}
      <div className="rounded-2xl bg-[#1E3A5F] text-white p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-[#b8941f] text-xs font-semibold uppercase tracking-wider mb-1">Your Case</p>
          <h2 className="text-xl font-bold">
            {caseData ? `Stage: ${stageLabel(caseData.stage)}` : 'Case not yet assigned'}
          </h2>
          <p className="text-white/70 text-sm mt-1">
            {caseData ? stageSubline(caseData.stage) : 'Your case will be assigned once your application is reviewed.'}
          </p>
        </div>
        <Link
          href="/student/case"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F3CE49] text-[#1E3A5F] font-semibold hover:bg-[#d4a51e] transition-colors whitespace-nowrap flex-shrink-0"
        >
          View My Case <ArrowRight size={16} />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Documents */}
        <Link href="/student/documents" className="block">
          <Card className="hover:border-[#F3CE49]/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#F3CE49]/10">
                  <FileText size={20} className="text-[#b8941f]" />
                </div>
                <div>
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">Visa Section</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">Upload Area</p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">View and upload your visa section →</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Messages */}
        <Link href="/student/case/messages" className="block">
          <Card className="hover:border-[#F3CE49]/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-blue-50">
                  <MessageCircle size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">Messages</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">
                    {newMessages > 0 ? `${newMessages} awaiting you` : tickets.length > 0 ? 'All caught up' : 'No messages yet'}
                  </p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">
                    {newMessages > 0 ? 'We replied — check your messages →' : 'Need help? Send us a message →'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Payments — when a balance is due, offer the SAME Pay-now checkout the
            My Case page uses (Stripe redirect) right here, instead of routing to
            the history page (which was a dead end pre-payment). When paid up, the
            tile links to the payment history. */}
        {outstandingInvoice ? (
          <Card className="h-full">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-orange-50">
                  <CreditCard size={20} className="text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">Payments</p>
                  <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">
                    {formatCurrency(outstandingInvoice.amount, outstandingInvoice.currency)}
                  </p>
                  <p className="text-xs text-[#4A4A4A]/70 mt-1">Outstanding balance</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <PayInvoiceButton invoiceId={outstandingInvoice.id} label="Pay now" />
                    <Link
                      href="/student/payments"
                      className="text-xs font-semibold text-[#1E3A5F] hover:text-[#b8941f] transition-colors"
                    >
                      History →
                    </Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Link href="/student/payments" className="block">
            <Card className="hover:border-[#F3CE49]/50 transition-colors cursor-pointer h-full">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-green-50">
                    <CreditCard size={20} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-[#4A4A4A]/60 uppercase tracking-wider">Payments</p>
                    <p className="text-lg font-bold text-[#1E3A5F] mt-0.5">All paid up</p>
                    <p className="text-xs text-[#4A4A4A]/70 mt-1">No pending payments</p>
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
              <MessageCircle size={16} className="text-[#b8941f]" />
              Latest Message
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestTicket && latestMessage ? (
              <div>
                <p className="text-xs text-[#4A4A4A]/60 mb-1">{latestTicket.subject}</p>
                <p className="text-sm text-[#4A4A4A] line-clamp-3">{latestMessage.body.slice(0, 160)}{latestMessage.body.length > 160 ? '…' : ''}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-[#4A4A4A]/50">
                    {latestMessage.sender?.name ?? 'Sorena Team'} · {timeAgo(latestMessage.createdAt)}
                  </span>
                  <Link
                    href="/student/case/messages"
                    className="text-xs font-semibold text-[#1E3A5F] hover:text-[#b8941f] transition-colors"
                  >
                    View all →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <MessageCircle size={28} className="text-[#4A4A4A]/20 mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">No messages yet.</p>
                <Link
                  href="/student/case/messages"
                  className="mt-2 inline-block text-sm font-semibold text-[#b8941f] hover:underline"
                >
                  Send us a message →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-[#1E3A5F] flex items-center gap-2">
              <Clock size={16} className="text-[#b8941f]" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tickets.length > 0 ? (
              <ol className="space-y-3">
                {tickets.slice(0, 3).map(t => (
                  <li key={t.id} className="flex items-start gap-3">
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-[#F3CE49] flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-[#1E3A5F] font-medium truncate">{t.subject}</p>
                      <p className="text-xs text-[#4A4A4A]/60">{timeAgo(t.updatedAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : caseData ? (
              <div className="text-center py-4">
                <CheckCircle size={28} className="text-green-400 mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">Your case is active and progressing.</p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Folder size={28} className="text-[#4A4A4A]/20 mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A]/60">Activity will appear here once your case begins.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
