import Link from 'next/link';
import { ArrowRight, Gavel, CheckCircle2, XCircle, HelpCircle, ArchiveX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import {
  decisionStyles, decisionLabel, formatRelative, formatDateTime,
} from '../_utils/format';

// PR-LIA-1 — Decisions log. Flattens LegalNote rows (where
// decision IS NOT NULL) across every case the LIA can see.

interface CaseRow {
  id: string;
  lead: { contact: { fullName: string | null } | null };
}

interface LegalNote {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  decision: string | null;
  decisionReason: string | null;
  createdAt: string;
}

interface DecisionWithContext extends LegalNote {
  decision: string; // narrowed
  contactName: string;
}

type SearchParams = { filter?: string };

export default async function LiaDecisionsPage({ searchParams }: { searchParams: SearchParams }) {
  let cases: CaseRow[] = [];
  let errorMsg: string | null = null;

  try {
    cases = await apiServer.get<CaseRow[]>('/cases');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load cases.';
  }

  const all: DecisionWithContext[] = [];
  for (const c of cases) {
    try {
      const notes = await apiServer.get<LegalNote[]>(`/cases/${c.id}/legal-notes`);
      for (const n of notes) {
        if (n.decision) {
          all.push({
            ...n,
            decision: n.decision,
            contactName: c.lead?.contact?.fullName ?? 'Unknown',
          });
        }
      }
    } catch {
      // Skip cases we can't read; non-fatal at the aggregate level.
    }
  }
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filter = (searchParams.filter ?? 'ALL').toUpperCase();
  const filtered =
    filter === 'ALL' ? all : all.filter(d => d.decision === filter);

  const buildHref = (f: string): string =>
    f === 'ALL' ? '/lia/decisions' : `/lia/decisions?filter=${f}`;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Decisions</h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">Formal LIA decisions recorded across all cases.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs font-semibold text-[#4A4A4A]/70 w-16">Outcome</span>
        {[
          { label: 'All',             value: 'ALL' },
          { label: 'Approved',        value: 'APPROVED' },
          { label: 'Rejected',        value: 'REJECTED' },
          { label: 'Needs more info', value: 'NEEDS_MORE_INFO' },
          { label: 'Withdrawn',       value: 'WITHDRAWN' },
        ].map(c => (
          <Link
            key={c.value}
            href={buildHref(c.value)}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === c.value
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Gavel size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No decisions recorded yet</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Decisions made via the case-detail action panel appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(d => (
                <li key={d.id} className="py-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${decisionStyles(d.decision)}`}>
                      <DecisionIcon decision={d.decision} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#1E3A5F]">{d.contactName}</span>
                        <span className="text-xs text-[#4A4A4A]/60">· Case {d.caseId.slice(0, 8)}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${decisionStyles(d.decision)}`}>
                          {decisionLabel(d.decision)}
                        </span>
                      </div>
                      <div className="text-xs text-[#4A4A4A]/70 mt-0.5">
                        {d.authorName ?? '—'} · {formatRelative(d.createdAt)} · {formatDateTime(d.createdAt)}
                      </div>
                      {d.decisionReason && (
                        <p className="text-sm text-[#4A4A4A] mt-2 whitespace-pre-wrap leading-relaxed">
                          {d.decisionReason}
                        </p>
                      )}
                    </div>
                    <Link href={`/lia/cases/${d.caseId}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]">
                      Open case <ArrowRight size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionIcon({ decision }: { decision: string }) {
  switch (decision) {
    case 'APPROVED':        return <CheckCircle2 size={18} />;
    case 'REJECTED':        return <XCircle size={18} />;
    case 'NEEDS_MORE_INFO': return <HelpCircle size={18} />;
    case 'WITHDRAWN':       return <ArchiveX size={18} />;
    default:                return <Gavel size={18} />;
  }
}
