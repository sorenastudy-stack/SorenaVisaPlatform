import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ScrollText, AlertTriangle, Clock, Lock, MessageSquare, FileText, CheckCircle2,
  Users, UserCheck, Scale, Gavel, FileSearch, ArrowRightLeft, Send, XCircle,
  RotateCcw, UserSquare2, Briefcase, Mail, Phone, Globe,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { displayCountry } from '@/lib/country-codes';
import { getSession } from '@/lib/auth';
import { formatDate, formatRelative, formatDateTime } from '../../../_utils/format';
import { ExportFileNoteButtons } from './ExportFileNoteButtons';

// PR-LIA-12 — Case File Note: chronological master log.
// Server component. Per-case access gate is enforced by the backend.
// If the API returns 403, render a friendly access-denied card.

interface TimelineEventBase {
  at: string;
  actorName: string | null;
}

type TimelineEvent =
  | (TimelineEventBase & { type: 'CASE_OPENED' })
  | (TimelineEventBase & { type: 'LIA_ASSIGNED'; details: { liaName: string; reason?: string } })
  | (TimelineEventBase & { type: 'LIA_REASSIGNED'; details: { fromLia: string | null; toLia: string | null; reason: string } })
  | (TimelineEventBase & { type: 'STAGE_CHANGED'; details: { from: string; to: string } })
  | (TimelineEventBase & { type: 'RISK_OVERRIDDEN'; details: { from: string; to: string; reason: string } })
  | (TimelineEventBase & { type: 'HARD_STOP_CLEARED'; details: { reason: string } })
  | (TimelineEventBase & { type: 'LEGAL_NOTE_ADDED'; details: { body: string } })
  | (TimelineEventBase & { type: 'DECISION_RECORDED'; details: { decision: string; reason: string } })
  | (TimelineEventBase & { type: 'CLIENT_MESSAGE'; actorName: string; details: { body: string; kind: string; isFromClient: boolean } })
  | (TimelineEventBase & { type: 'DOCUMENT_UPLOADED'; details: { fileName: string; source: string; docType: string | null } })
  | (TimelineEventBase & { type: 'DOCUMENT_REVIEWED'; details: { fileName: string; status: string; reason: string } })
  | (TimelineEventBase & { type: 'TICKET_OPENED'; actorName: string; details: { subject: string; department: string; ticketId: string } })
  | (TimelineEventBase & { type: 'TICKET_MESSAGE'; actorName: string; details: { ticketId: string; body: string; isInternal: boolean } })
  | (TimelineEventBase & { type: 'MEETING_HELD'; details: { title: string; transcriptAvailable: boolean; notes: string | null } })
  | (TimelineEventBase & { type: 'INZ_SUBMITTED'; details: { applicationNumber: string; notes: string | null } })
  | (TimelineEventBase & { type: 'INZ_SUBMISSION_EDITED'; details: { changedFields: string[] } })
  | (TimelineEventBase & { type: 'INZ_SUBMISSION_REVERTED'; details: { reason: string } })
  | (TimelineEventBase & { type: 'VISA_ISSUED'; details: { startDate: string; endDate: string } })
  | (TimelineEventBase & { type: 'VISA_DECLINED'; details: { declineReason: string } })
  | (TimelineEventBase & { type: 'VISA_RECORD_REVERTED'; details: { reason: string } })
  | (TimelineEventBase & { type: 'OFFICER_LINKED'; details: { officerName: string; note: string | null; outcomeSnapshot: string | null } })
  | (TimelineEventBase & { type: 'OFFICER_UNLINKED' });

interface FileNoteTimeline {
  generatedAt: string;
  case: {
    id: string;
    stage: string;
    riskLevel: string;
    createdAt: string;
    updatedAt: string;
    applicant: {
      fullName: string | null;
      email: string | null;
      phone: string | null;
      countryOfResidence: string | null;
    };
    assignedLia: { id: string; name: string } | null;
    assignedOwner: { id: string; name: string } | null;
    visa: { outcome: string; visaStartDate: string | null; visaEndDate: string | null } | null;
    inz: { inzApplicationNumber: string; inzSubmittedAt: string } | null;
  };
  events: TimelineEvent[];
  counts: {
    messages: number;
    documents: number;
    decisions: number;
    meetings: number;
    officerLinkages: number;
    totalEvents: number;
  };
}

export default async function CaseFileNotePage({ params }: { params: { id: string } }) {
  const session = await getSession();

  let data: FileNoteTimeline | null = null;
  let errorStatus: number | null = null;
  let errorMsg: string | null = null;

  try {
    data = await apiServer.get<FileNoteTimeline>(`/cases/${params.id}/file-note`);
  } catch (e) {
    if (e instanceof ApiServerError) {
      if (e.statusCode === 404) notFound();
      errorStatus = e.statusCode;
      errorMsg = e.message;
    } else {
      errorMsg = 'Failed to load case file note.';
    }
  }

  if (errorStatus === 403) {
    return (
      <div className="max-w-4xl">
        <BackLink href={`/lia/cases/${params.id}`} label="Back to case" />
        <Card className="border-amber-200 bg-amber-50">
          <CardContent>
            <div className="flex items-start gap-3">
              <Lock size={20} className="text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-base font-bold text-amber-900">Access not granted</h2>
                <p className="text-sm text-amber-800 mt-1 leading-relaxed">
                  You don't have access to this case file. The Case File Note is restricted to staff
                  allocated to the case (assigned LIA, assigned owner, or OWNER / ADMIN / SUPER_ADMIN).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorMsg || !data) {
    return (
      <div className="max-w-4xl">
        <BackLink href={`/lia/cases/${params.id}`} label="Back to case" />
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">
            {errorMsg ?? 'File note unavailable.'}
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = data.case;

  return (
    <div className="max-w-5xl">
      <BackLink href={`/lia/cases/${params.id}`} label="Back to case" />

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <ScrollText size={22} className="text-[#E8B923]" />
            Case File Note
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            {c.applicant.fullName ?? 'Unknown applicant'} · Case {c.id.slice(0, 8)} ·{' '}
            <span className="text-[#4A4A4A]/50">read-only · every view is audited</span>
          </p>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FAF8F3] text-[#4A4A4A] border border-gray-200 mt-2">
            Generated {formatRelative(data.generatedAt)}
          </span>
        </div>
        <ExportFileNoteButtons caseId={c.id} userRole={session?.role ?? ''} />
      </div>

      {/* Overview */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Row icon={<UserCheck size={14} />} label="Applicant" value={c.applicant.fullName ?? '—'} />
              <Row icon={<Mail size={14} />} label="Email" value={c.applicant.email ?? '—'} />
              <Row icon={<Phone size={14} />} label="Phone" value={c.applicant.phone ?? '—'} />
              <Row icon={<Globe size={14} />} label="Country" value={displayCountry(c.applicant.countryOfResidence) ?? '—'} />
            </div>
            <div className="space-y-2">
              <Row icon={<Briefcase size={14} />} label="Stage" value={c.stage} />
              <Row icon={<AlertTriangle size={14} />} label="Risk" value={c.riskLevel} />
              <Row icon={<UserCheck size={14} />} label="Assigned LIA" value={c.assignedLia?.name ?? '—'} />
              <Row icon={<UserCheck size={14} />} label="Assigned owner" value={c.assignedOwner?.name ?? '—'} />
              {c.inz && (
                <Row icon={<Send size={14} />} label="INZ ref" value={`${c.inz.inzApplicationNumber} · ${formatDate(c.inz.inzSubmittedAt)}`} />
              )}
              {c.visa && (
                <Row
                  icon={c.visa.outcome === 'APPROVED' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  label="Visa outcome"
                  value={`${c.visa.outcome}${c.visa.visaStartDate && c.visa.visaEndDate
                    ? ` · ${formatDate(c.visa.visaStartDate)} → ${formatDate(c.visa.visaEndDate)}`
                    : ''}`}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Counts strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <CountTile label="Messages" value={data.counts.messages} />
        <CountTile label="Documents" value={data.counts.documents} />
        <CountTile label="Decisions" value={data.counts.decisions} />
        <CountTile label="Meetings" value={data.counts.meetings} />
        <CountTile label="Officer linkages" value={data.counts.officerLinkages} />
        <CountTile label="Total events" value={data.counts.totalEvents} tone="gold" />
      </div>

      {/* Timeline */}
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-[#E8B923]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">Timeline</h2>
            <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{data.events.length}</span>
          </div>

          {data.events.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center italic">
              No events recorded yet.
            </p>
          ) : (
            <ol className="relative border-l-2 border-[#1E3A5F]/10 ml-3">
              {data.events.map((e, i) => (
                <li key={i} className="ml-5 mb-5 last:mb-0">
                  <span className={`absolute -left-[9px] mt-1 flex items-center justify-center w-4 h-4 rounded-full ${dotColor(e.type)}`} />
                  <TimelineCard event={e} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[#4A4A4A]/50 flex-shrink-0">{icon}</span>
      <span className="text-[#4A4A4A]/60 text-xs">{label}:</span>
      <span className="text-[#1E3A5F] font-medium min-w-0 truncate">{value}</span>
    </div>
  );
}

function CountTile({ label, value, tone = 'navy' }: { label: string; value: number; tone?: 'navy' | 'gold' }) {
  const tones = {
    navy: 'bg-[#1E3A5F]/5 text-[#1E3A5F]',
    gold: 'bg-[#E8B923]/20 text-[#1E3A5F]',
  };
  return (
    <div className={`rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-xl font-bold leading-none">{value}</div>
      <div className="text-xs font-semibold mt-1">{label}</div>
    </div>
  );
}

function dotColor(type: TimelineEvent['type']): string {
  // Case lifecycle → navy
  if (type === 'CASE_OPENED' || type === 'STAGE_CHANGED' || type === 'LIA_ASSIGNED' || type === 'LIA_REASSIGNED') {
    return 'bg-[#1E3A5F]';
  }
  // LIA actions → gold
  if (
    type === 'LEGAL_NOTE_ADDED' ||
    type === 'DECISION_RECORDED' ||
    type === 'OFFICER_LINKED' ||
    type === 'RISK_OVERRIDDEN' ||
    type === 'HARD_STOP_CLEARED'
  ) {
    return 'bg-[#E8B923]';
  }
  // Client communication → emerald
  if (type === 'CLIENT_MESSAGE' || type === 'TICKET_OPENED' || type === 'TICKET_MESSAGE') {
    return 'bg-emerald-500';
  }
  // Documents → neutral
  if (type === 'DOCUMENT_UPLOADED' || type === 'DOCUMENT_REVIEWED') {
    return 'bg-gray-400';
  }
  // Visa / INZ success → emerald, decline → red
  if (type === 'INZ_SUBMITTED' || type === 'VISA_ISSUED') return 'bg-emerald-600';
  if (type === 'VISA_DECLINED') return 'bg-red-600';
  // Reversions → amber
  if (type === 'INZ_SUBMISSION_REVERTED' || type === 'VISA_RECORD_REVERTED' || type === 'OFFICER_UNLINKED') {
    return 'bg-amber-500';
  }
  // Meetings → violet
  if (type === 'MEETING_HELD') return 'bg-violet-500';
  return 'bg-gray-300';
}

function eventIcon(type: TimelineEvent['type']): React.ReactNode {
  switch (type) {
    case 'CASE_OPENED':              return <Briefcase size={14} />;
    case 'LIA_ASSIGNED':
    case 'LIA_REASSIGNED':           return <UserCheck size={14} />;
    case 'STAGE_CHANGED':            return <ArrowRightLeft size={14} />;
    case 'RISK_OVERRIDDEN':          return <AlertTriangle size={14} />;
    case 'HARD_STOP_CLEARED':        return <CheckCircle2 size={14} />;
    case 'LEGAL_NOTE_ADDED':         return <Scale size={14} />;
    case 'DECISION_RECORDED':        return <Gavel size={14} />;
    case 'CLIENT_MESSAGE':           return <MessageSquare size={14} />;
    case 'DOCUMENT_UPLOADED':        return <FileText size={14} />;
    case 'DOCUMENT_REVIEWED':        return <FileSearch size={14} />;
    case 'TICKET_OPENED':
    case 'TICKET_MESSAGE':           return <Users size={14} />;
    case 'MEETING_HELD':             return <Clock size={14} />;
    case 'INZ_SUBMITTED':            return <Send size={14} />;
    case 'INZ_SUBMISSION_EDITED':    return <FileText size={14} />;
    case 'INZ_SUBMISSION_REVERTED':  return <RotateCcw size={14} />;
    case 'VISA_ISSUED':              return <CheckCircle2 size={14} />;
    case 'VISA_DECLINED':            return <XCircle size={14} />;
    case 'VISA_RECORD_REVERTED':     return <RotateCcw size={14} />;
    case 'OFFICER_LINKED':           return <UserSquare2 size={14} />;
    case 'OFFICER_UNLINKED':         return <UserSquare2 size={14} />;
  }
}

function eventLabel(type: TimelineEvent['type']): string {
  return type.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function TimelineCard({ event }: { event: TimelineEvent }) {
  const detail = renderDetail(event);
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-[#1E3A5F]/60">{eventIcon(event.type)}</span>
        <span className="text-sm font-bold text-[#1E3A5F]">{eventLabel(event.type)}</span>
        <span className="text-xs text-[#4A4A4A]/60 ml-auto">{formatDateTime(event.at)}</span>
      </div>
      <div className="text-xs text-[#4A4A4A]/70 mb-2">
        by <span className="font-semibold text-[#1E3A5F]/80">{event.actorName ?? 'system'}</span>
      </div>
      {detail && (
        <div className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{detail}</div>
      )}
    </div>
  );
}

function renderDetail(e: TimelineEvent): string | null {
  switch (e.type) {
    case 'CASE_OPENED':              return null;
    case 'LIA_ASSIGNED':             return `${e.details.liaName} assigned`;
    case 'LIA_REASSIGNED': {
      if (e.details.fromLia && e.details.toLia) return `${e.details.fromLia} → ${e.details.toLia}`;
      if (e.details.toLia)   return `assigned to ${e.details.toLia}`;
      if (e.details.fromLia) return `cleared (was ${e.details.fromLia})`;
      return 'LIA assignment changed';
    }
    case 'STAGE_CHANGED':            return `${e.details.from} → ${e.details.to}`;
    case 'RISK_OVERRIDDEN':          return `${e.details.from} → ${e.details.to}\n${e.details.reason}`;
    case 'HARD_STOP_CLEARED':        return e.details.reason || 'Hard stop cleared.';
    case 'LEGAL_NOTE_ADDED':         return e.details.body;
    case 'DECISION_RECORDED':        return `Decision: ${e.details.decision}\n\n${e.details.reason}`;
    case 'CLIENT_MESSAGE':           return `${e.details.isFromClient ? 'Client' : 'LIA'} (${e.details.kind})\n${e.details.body}`;
    case 'DOCUMENT_UPLOADED':        return `${e.details.fileName} · ${e.details.source}${e.details.docType ? ' / ' + e.details.docType : ''}`;
    case 'DOCUMENT_REVIEWED':        return `${e.details.status} — ${e.details.reason}`;
    case 'TICKET_OPENED':            return `${e.details.department}: ${e.details.subject}`;
    case 'TICKET_MESSAGE':           return `${e.details.isInternal ? '[internal] ' : ''}${e.details.body}`;
    case 'MEETING_HELD': {
      const head = `${e.details.title}${e.details.transcriptAvailable ? ' · transcript available' : ''}`;
      return e.details.notes ? `${head}\n\n${e.details.notes}` : head;
    }
    case 'INZ_SUBMITTED':            return `application #${e.details.applicationNumber}`;
    case 'INZ_SUBMISSION_EDITED':    return e.details.changedFields.length > 0
                                       ? `changed: ${e.details.changedFields.join(', ')}`
                                       : 'edited';
    case 'INZ_SUBMISSION_REVERTED':  return e.details.reason;
    case 'VISA_ISSUED':              return `valid ${e.details.startDate} → ${e.details.endDate}`;
    case 'VISA_DECLINED':            return e.details.declineReason;
    case 'VISA_RECORD_REVERTED':     return e.details.reason;
    case 'OFFICER_LINKED': {
      const head = `${e.details.officerName}${e.details.outcomeSnapshot ? ` (outcome at link: ${e.details.outcomeSnapshot})` : ''}`;
      return e.details.note ? `${head}\n\n${e.details.note}` : head;
    }
    case 'OFFICER_UNLINKED':         return 'Officer link cleared.';
  }
}
