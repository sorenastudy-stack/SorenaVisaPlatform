import { MessageCircle, FilePlus2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ReplyComposer } from './ReplyComposer';
import { FulfilRequestButton } from './FulfilRequestButton';

// PR-LIA-4 — Client-side case-thread page.
//
// Mirrors the LIA-side card on /lia/cases/[id]. Server-renders the
// thread; mutations (reply, fulfil) live in client components.

interface CaseMessage {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  authorRole: 'LIA' | 'CLIENT';
  kind: 'MESSAGE' | 'DOCUMENT_REQUEST' | 'PROGRESS_UPDATE';
  body: string;
  requestedDocType: string | null;
  fulfilledByFileId: string | null;
  fulfilledByFileName: string | null;
  fulfilledAt: string | null;
  readByClient: boolean;
  readByLia: boolean;
  createdAt: string;
}

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-NZ', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

function formatWhen(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days <= 7) return `${days}d ago`;
  return DATE_TIME_FMT.format(d);
}

export default async function StudentCaseMessagesPage() {
  let messages: CaseMessage[] = [];
  let errorMsg: string | null = null;

  try {
    messages = await apiServer.get<CaseMessage[]>('/students/me/case-messages');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load messages.';
  }

  return (
    <div className="max-w-3xl">
      <BackLink href="/student" label="Back to portal" />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Messages with your specialist</h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">
          Direct conversation with your Sorena specialist. Document requests appear here too.
        </p>
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent>
          {messages.length === 0 ? (
            <div className="py-10 text-center">
              <MessageCircle size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No messages yet</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">
                Your specialist will reach out here when needed.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <ClientMessageBubble key={m.id} message={m} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="text-sm font-semibold text-[#1E3A5F] mb-3">Send a reply</h2>
          <ReplyComposer />
        </CardContent>
      </Card>
    </div>
  );
}

function ClientMessageBubble({ message }: { message: CaseMessage }) {
  if (message.kind === 'PROGRESS_UPDATE') {
    return (
      <li className="rounded-xl border border-[#1E3A5F]/30 bg-[#1E3A5F]/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-[#1E3A5F] text-white">
            Progress update
          </span>
          <span className="text-xs text-[#4A4A4A]/70 ml-auto">
            {message.authorName ?? 'Sorena specialist'} · {formatWhen(message.createdAt)}
          </span>
        </div>
        <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{message.body}</p>
      </li>
    );
  }

  if (message.kind === 'DOCUMENT_REQUEST') {
    const fulfilled = !!message.fulfilledByFileId;
    return (
      <li className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <FilePlus2 size={14} className="text-amber-700" />
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            Document requested: {message.requestedDocType ?? '—'}
          </span>
          {fulfilled && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 size={12} /> Fulfilled
            </span>
          )}
          <span className="text-xs text-amber-700/80 ml-auto">
            {message.authorName ?? 'Sorena specialist'} · {formatWhen(message.createdAt)}
          </span>
        </div>
        <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{message.body}</p>
        {fulfilled ? (
          <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-800">
            <span className="font-semibold">You shared:</span> {message.fulfilledByFileName ?? '—'}
          </div>
        ) : (
          <div className="mt-3 pt-3 border-t border-amber-200">
            <FulfilRequestButton messageId={message.id} requestedDocType={message.requestedDocType} />
          </div>
        )}
      </li>
    );
  }

  // Plain MESSAGE — client right-aligned gold (their own side), LIA left-aligned white.
  const isOwn = message.authorRole === 'CLIENT';
  return (
    <li className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl p-4 ${
          isOwn
            ? 'bg-[#E8B923]/10 border border-[#E8B923]/30'
            : 'bg-white border border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#1E3A5F]">
            {isOwn ? 'You' : (message.authorName ?? 'Sorena specialist')}
          </span>
          <span className="text-xs text-[#4A4A4A]/60">· {formatWhen(message.createdAt)}</span>
        </div>
        <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{message.body}</p>
      </div>
    </li>
  );
}
