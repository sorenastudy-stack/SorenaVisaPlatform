'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Inbox, Lock, Mail, Send, UserCog, Clock, AlertTriangle, Paperclip, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import { TicketDepartmentBadge } from '@/components/tickets/TicketDepartmentBadge';
import {
  StaffTicketMessages,
  type StaffThreadMessage,
  type TicketAttachment,
} from '@/components/staff/tickets/StaffTicketMessages';
import { useStaff } from '@/contexts/StaffContext';

// PR-SUPPORT-1 — Staff ticket detail.
//
// Non-async params: Next 14 passes `params` as a plain object on this
// project. Do NOT type as Promise<> and do NOT use React's `use()`
// hook — see the leads/wix-payments detail pages which were both
// crashing on that pattern earlier in this session.

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

interface TicketMessage {
  id: string;
  authorId: string;
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorName: string | null;
  authorStaffRole: string | null;
  body: string;
  bodyIsHtml?: boolean;
  attachments?: TicketAttachment[];
  isInternalNote: boolean;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  subject: string;
  status: TicketStatus;
  department: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  clientId: string;
  clientName: string | null;
  clientEmail: string | null;
  caseId: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedStaffRole: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  lastClientMessageAt: string | null;
  lastStaffMessageAt: string | null;
  unansweredOver24h?: boolean;
  messages: TicketMessage[];
}

interface Assignee {
  id: string;
  name: string;
  role: string;
}

const STATUS_VALUES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
// PR-TICKETS-CYCLE — "any staff member can reassign". The target is still
// restricted server-side to the ticket's VisaCase cycle (and the picker only
// lists those), so widening WHO can open the control is safe.
const ASSIGN_ROLES = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA']);

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function StaffTicketDetailPage({
  params,
}: { params: { id: string } }) {
  const { id } = params;
  const { me } = useStaff();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canAssign = ASSIGN_ROLES.has(me?.role ?? '');

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<TicketDetail>(`/staff/tickets/${id}`);
      setTicket(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load ticket.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Candidates are scoped to this ticket's case cycle (per-ticket route).
    api.get<Assignee[]>(`/staff/tickets/${id}/assignees`)
      .then(setAssignees)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="text-sm text-[#4A4A4A]/60 py-4">Loading…</div>;

  if (error || !ticket) {
    return (
      <div>
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error ?? 'Ticket not found'}
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === 'CLOSED';
  const threadMessages: StaffThreadMessage[] = ticket.messages.map((m) => ({
    id: m.id,
    authorRole: m.authorRole,
    authorName: m.authorName,
    authorStaffRole: m.authorStaffRole,
    body: m.body,
    bodyIsHtml: m.bodyIsHtml,
    attachments: m.attachments,
    isInternalNote: m.isInternalNote,
    createdAt: m.createdAt,
  }));

  return (
    <div className="max-w-5xl">
      <BackLink />

      {/* Header */}
      <Card className="mb-4">
        <CardContent>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-start gap-2">
                <Inbox size={20} className="text-[#b8941f] mt-1 flex-shrink-0" />
                <span className="break-words">{ticket.subject}</span>
              </h1>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-sm text-[#4A4A4A]/70">
                <span className="inline-flex items-center gap-1">
                  <Mail size={12} />
                  {ticket.clientName ?? 'unknown'}
                  {ticket.clientEmail && (
                    <span className="text-[#4A4A4A]/60"> · {ticket.clientEmail}</span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} /> Opened {formatDateTime(ticket.createdAt)}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <TicketStatusBadge status={ticket.status} />
                <TicketDepartmentBadge department={ticket.department} />
                <span className="inline-flex items-center font-semibold rounded-full border px-2 py-0.5 text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                  Priority: {ticket.priority}
                </span>
                {ticket.unansweredOver24h && (
                  <span className="inline-flex items-center gap-1 font-bold rounded-full border px-2 py-0.5 text-[10px] bg-red-50 text-red-700 border-red-300">
                    <AlertTriangle size={11} /> No reply 24h+
                  </span>
                )}
              </div>
            </div>
            <div className="text-xs text-[#4A4A4A]/60 font-mono">
              {ticket.id.slice(0, 8)}…
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column — actions */}
        <div className="lg:col-span-1 space-y-4">
          <StatusCard
            current={ticket.status}
            ticketId={ticket.id}
            onSaved={() => load()}
          />
          {canAssign && (
            <AssignmentCard
              current={{
                id: ticket.assignedStaffId,
                name: ticket.assignedStaffName,
                role: ticket.assignedStaffRole,
              }}
              assignees={assignees}
              ticketId={ticket.id}
              onSaved={() => load()}
            />
          )}
          <Card>
            <CardContent>
              <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-2">
                Timestamps
              </h2>
              <dl className="space-y-1.5 text-xs text-[#4A4A4A]">
                <Row label="Last client reply" value={formatDateTime(ticket.lastClientMessageAt)} />
                <Row label="Last staff reply" value={formatDateTime(ticket.lastStaffMessageAt)} />
                <Row label="Resolved at" value={formatDateTime(ticket.resolvedAt)} />
                <Row label="Closed at" value={formatDateTime(ticket.closedAt)} />
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Right column — thread + reply */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent>
              <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3">
                Conversation
              </h2>
              {threadMessages.length === 0 ? (
                <p className="text-sm text-[#4A4A4A]/60 italic">No messages yet.</p>
              ) : (
                <StaffTicketMessages messages={threadMessages} />
              )}
            </CardContent>
          </Card>

          {isClosed ? (
            <Card>
              <CardContent>
                <p className="text-sm text-[#4A4A4A]/70 italic">
                  This ticket is closed. Reopen it from the status control to reply.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ReplyCard ticketId={ticket.id} onSent={() => load()} />
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/staff/tickets"
      className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] font-medium mb-4"
    >
      <ArrowLeft size={14} /> Back to tickets
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[#4A4A4A]/70">{label}</dt>
      <dd className="text-[#1E3A5F] font-medium">{value}</dd>
    </div>
  );
}

// ─── StatusCard ────────────────────────────────────────────────────

function StatusCard({
  current, ticketId, onSaved,
}: { current: TicketStatus; ticketId: string; onSaved: () => void }) {
  const [next, setNext] = useState<TicketStatus>(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setNext(current); }, [current]);

  async function save() {
    if (next === current) return;
    setErr(null);
    setSaving(true);
    try {
      await api.patch(`/staff/tickets/${ticketId}/status`, { status: next });
      onSaved();
    } catch (e: any) {
      if (e?.statusCode === 403) setErr('Your role can’t change ticket status.');
      else setErr(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3">Status</h2>
        <div className="mb-3">
          <TicketStatusBadge status={current} />
        </div>
        <select
          value={next}
          onChange={(e) => setNext(e.target.value as TicketStatus)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>
          ))}
        </select>
        {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving || next === current}
          style={{ minHeight: 48 }}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save status'}
        </button>
      </CardContent>
    </Card>
  );
}

// ─── AssignmentCard ────────────────────────────────────────────────

function AssignmentCard({
  current, assignees, ticketId, onSaved,
}: {
  current: { id: string | null; name: string | null; role: string | null };
  assignees: Assignee[];
  ticketId: string;
  onSaved: () => void;
}) {
  const [next, setNext] = useState<string>(current.id ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setNext(current.id ?? ''); }, [current.id]);

  async function save() {
    if ((next || null) === (current.id ?? null)) return;
    setErr(null);
    setSaving(true);
    try {
      await api.patch(`/staff/tickets/${ticketId}/assign`, {
        assignedStaffId: next.length > 0 ? next : null,
      });
      onSaved();
    } catch (e: any) {
      if (e?.statusCode === 403) setErr('A ticket can only be assigned to staff already on its case.');
      else setErr(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3 inline-flex items-center gap-1">
          <UserCog size={13} /> Assignment
        </h2>
        <div className="mb-3 text-sm text-[#1E3A5F]">
          {current.name
            ? <>{current.name} <span className="text-xs text-[#4A4A4A]/70">({current.role})</span></>
            : <span className="italic text-[#4A4A4A]/60">Unassigned</span>}
        </div>
        <select
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
          ))}
        </select>
        {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving || (next || null) === (current.id ?? null)}
          style={{ minHeight: 48 }}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg border-2 border-[#1E3A5F] text-[#1E3A5F] text-sm font-bold hover:bg-[#1E3A5F]/5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Reassign'}
        </button>
      </CardContent>
    </Card>
  );
}

// ─── ReplyCard ────────────────────────────────────────────────────

const ATTACH_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function ReplyCard({
  ticketId, onSent,
}: { ticketId: string; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Rich-text body carries HTML tags; "has content" means real text once tags
  // are stripped. A message may also be attachment-only.
  const hasText = body.replace(/<[^>]*>/g, '').trim().length > 0;
  const canSend = (hasText || attachments.length > 0) && !sending && !uploading;

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) { setErr(`Up to ${MAX_ATTACHMENTS} attachments.`); return; }
    setUploading(true);
    try {
      for (const f of picked) {
        if (f.size > ATTACH_MAX_BYTES) { setErr(`${f.name} is larger than 10 MB.`); continue; }
        const fd = new FormData();
        fd.append('file', f);
        const meta = await api.upload<TicketAttachment & { key: string }>(
          `/staff/tickets/${ticketId}/attachments`, fd,
        );
        setAttachments((prev) => [...prev, meta]);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeAttachment(i: number) {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    if (!canSend) return;
    setErr(null);
    setSending(true);
    try {
      await api.post(`/staff/tickets/${ticketId}/messages`, {
        body,
        isInternalNote,
        // Send back the metadata (incl. the R2 key) the upload returned.
        attachments,
      });
      setBody('');
      setIsInternalNote(false);
      setAttachments([]);
      onSent();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3">
          {isInternalNote ? 'New internal note' : 'Reply to client'}
        </h2>

        <RichTextEditor
          value={body}
          onChange={setBody}
          disabled={sending}
          ariaLabel={isInternalNote ? 'Internal note' : 'Reply to client'}
          placeholder={
            isInternalNote
              ? 'Internal note — visible only to staff with ticket access.'
              : 'Reply visible to the client…'
          }
        />

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-[#faf8f3] px-2.5 py-1.5 text-xs text-[#1E3A5F]">
                <Paperclip size={11} className="text-[#b8941f]" />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`}
                        className="text-gray-400 hover:text-red-600">
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ATTACH_ACCEPT}
          multiple
          onChange={(e) => onPickFiles(e.target.files)}
          className="hidden"
        />

        <div className="mt-2 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-sm text-[#4A4A4A] cursor-pointer">
              <input
                type="checkbox"
                checked={isInternalNote}
                onChange={(e) => setIsInternalNote(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="inline-flex items-center gap-1">
                <Lock size={12} /> Internal note
              </span>
            </label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f]/25 px-3 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#faf8f3] disabled:opacity-50"
            >
              <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach file'}
            </button>
          </div>
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            style={{ minHeight: 48 }}
            className={[
              'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50',
              isInternalNote
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-[#1E3A5F] text-white hover:bg-[#162d49]',
            ].join(' ')}
          >
            <Send size={13} />
            {sending ? 'Sending…' : isInternalNote ? 'Post internal note' : 'Send reply'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[#4A4A4A]/50">JPG, PNG, WebP, or PDF · max 10&nbsp;MB · up to {MAX_ATTACHMENTS} files.</p>
        {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      </CardContent>
    </Card>
  );
}
