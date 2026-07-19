'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Pencil, Trash2, X, Check, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { RichTextEditor } from '@/components/ui/RichTextEditor';

// PR-LIA-CONVO-NOTES — LIA conversation notes on a case (client component).
//
// Reachable by LIA / OWNER / SUPER_ADMIN only; the parent decides whether to
// render this at all (server-side role gate), and the backend re-enforces the
// same allowlist on every request — this component never grants access on its
// own. Each note shows author + timestamp, newest first. The author (and any
// OWNER / SUPER_ADMIN) may edit or delete; the server returns `canEdit` per note
// so the buttons match exactly what the server would allow. English-only.

interface ConversationNote {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  bodyHtml: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

const NAVY = '#1e3a5f';

const fmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const when = (iso: string) => fmt.format(new Date(iso));

export function ConversationNotesPanel({ caseId }: { caseId: string }) {
  const [notes, setNotes] = useState<ConversationNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Composer (new note)
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<ConversationNote[]>(`/cases/${caseId}/conversation-notes`)
      .then(setNotes)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Could not load conversation notes.'),
      );
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const bodyHasContent = (html: string) => html.replace(/<[^>]*>/g, '').trim().length > 0;

  const onCreate = async () => {
    if (!bodyHasContent(draft) || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(`/cases/${caseId}/conversation-notes`, { body: draft });
      setDraft('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the note.');
    } finally { setSaving(false); }
  };

  const startEdit = (n: ConversationNote) => { setEditingId(n.id); setEditDraft(n.bodyHtml); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(''); };

  const onSaveEdit = async (id: string) => {
    if (!bodyHasContent(editDraft)) return;
    setBusyId(id); setError(null);
    try {
      await api.patch(`/cases/${caseId}/conversation-notes/${id}`, { body: editDraft });
      cancelEdit();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the note.');
    } finally { setBusyId(null); }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this conversation note? This cannot be undone.')) return;
    setBusyId(id); setError(null);
    try {
      await api.delete(`/cases/${caseId}/conversation-notes/${id}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the note.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-1 inline-flex items-center gap-2 text-sm font-bold" style={{ color: NAVY }}>
        <MessageSquareText size={18} className="text-[#c9a961]" /> Conversation notes
      </div>
      <p className="mb-5 text-xs" style={{ color: 'rgba(74,74,74,0.6)' }}>
        Private to the legal team (LIA, Owner, and Super Admin). The client and the
        case consultant never see these.
      </p>

      {/* Composer */}
      <div className="mb-6">
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          disabled={saving}
          ariaLabel="New conversation note"
          placeholder="Record what was discussed with the client…"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onCreate}
            disabled={saving || !bodyHasContent(draft)}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl px-5 text-sm font-bold text-white transition-colors disabled:opacity-50"
            style={{ background: NAVY }}
          >
            <Plus size={16} /> {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* List — newest first */}
      {notes === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          No conversation notes yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {notes.map((n) => {
            const editing = editingId === n.id;
            const busy = busyId === n.id;
            return (
              <li key={n.id} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs" style={{ color: 'rgba(74,74,74,0.7)' }}>
                    <span className="font-semibold" style={{ color: NAVY }}>
                      {n.authorName ?? 'Unknown'}
                    </span>
                    <span className="mx-1.5">·</span>
                    <span>{when(n.createdAt)}</span>
                    {n.updatedAt !== n.createdAt && (
                      <span className="ml-1.5 italic text-gray-400">(edited)</span>
                    )}
                  </div>
                  {n.canEdit && !editing && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button" aria-label="Edit note" title="Edit"
                        onClick={() => startEdit(n)} disabled={busy}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-[#faf8f3] hover:text-[#1e3a5f] disabled:opacity-40"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" aria-label="Delete note" title="Delete"
                        onClick={() => onDelete(n.id)} disabled={busy}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {editing ? (
                  <div>
                    <RichTextEditor
                      value={editDraft}
                      onChange={setEditDraft}
                      disabled={busy}
                      ariaLabel="Edit conversation note"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button" onClick={cancelEdit} disabled={busy}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        <X size={15} /> Cancel
                      </button>
                      <button
                        type="button" onClick={() => onSaveEdit(n.id)}
                        disabled={busy || !bodyHasContent(editDraft)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white transition-colors disabled:opacity-50"
                        style={{ background: NAVY }}
                      >
                        <Check size={15} /> {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="rte-content text-sm leading-relaxed"
                    style={{ color: NAVY }}
                    // Server-sanitized HTML (allowlist in rich-text-sanitizer.ts).
                    dangerouslySetInnerHTML={{ __html: n.bodyHtml }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <style jsx global>{`
        .rte-content ul { list-style: disc; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content ol { list-style: decimal; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content a { color: ${NAVY}; text-decoration: underline; }
      `}</style>
    </div>
  );
}
