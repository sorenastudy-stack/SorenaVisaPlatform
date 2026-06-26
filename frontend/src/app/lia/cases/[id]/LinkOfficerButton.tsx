'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Plus, X, UserSquare2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — Link a reviewing officer to a case.
// Officer search is debounced 300ms against GET /officers?search=...
// "Create new officer" link bounces out to /lia/officers (where the
// existing AddOfficerButton lives) so we don't duplicate the form here.

interface OfficerSearchHit {
  id: string;
  fullName: string;
  branch: string | null;
  countryOfPosting: string | null;
}

interface ListResponse {
  data: OfficerSearchHit[];
  total: number;
}

export function LinkOfficerButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<OfficerSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<OfficerSearchHit | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const term = search.trim();
    if (term.length === 0) {
      setResults([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<ListResponse>(
          `/officers?search=${encodeURIComponent(term)}&pageSize=10`,
        );
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search, open]);

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setSearch('');
    setResults([]);
    setSelected(null);
    setNote('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/officer-linkage`, {
        officerId: selected.id,
        note: note.trim() || undefined,
      });
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to link officer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] text-white text-xs font-bold px-3 py-2 hover:bg-[#F3CE49] hover:text-[#1E3A5F] transition-colors"
      >
        <UserSquare2 size={12} />
        Link reviewing officer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <UserSquare2 size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Link reviewing officer</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              The outcome at link time is snapshotted on the linkage. If the visa decision changes later, re-link to refresh.
            </p>

            {!selected && (
              <>
                <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Search officers</label>
                <div className="relative mb-2">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4A4A]/50" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                    placeholder="Type a name, branch, or country…"
                    className="w-full min-h-[44px] pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none"
                  />
                </div>

                {loading && <p className="text-xs text-[#4A4A4A]/60 mb-2">Searching…</p>}

                {search.trim().length > 0 && !loading && results.length === 0 && (
                  <div className="text-sm text-[#4A4A4A]/70 bg-[#FAF8F3] border border-gray-200 rounded-lg p-3 mb-2">
                    No officers match "{search.trim()}".{' '}
                    <Link href="/lia/officers" className="underline font-semibold text-[#1E3A5F] hover:text-[#b8941f]">
                      <Plus size={11} className="inline" /> Create a new officer
                    </Link>
                  </div>
                )}

                {results.length > 0 && (
                  <ul className="space-y-1 max-h-60 overflow-y-auto border border-gray-100 rounded-lg p-1 mb-3">
                    {results.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(o)}
                          className="w-full text-left rounded-lg px-3 py-2 hover:bg-[#FAF8F3] transition-colors"
                        >
                          <div className="font-semibold text-sm text-[#1E3A5F]">{o.fullName}</div>
                          <div className="text-xs text-[#4A4A4A]/70 mt-0.5">
                            {o.branch ?? '—'}{o.countryOfPosting && ` · ${o.countryOfPosting}`}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {selected && (
              <>
                <div className="mb-4 rounded-lg border border-[#1E3A5F]/20 bg-[#1E3A5F]/5 p-3 flex items-start gap-3">
                  <UserSquare2 size={16} className="text-[#1E3A5F] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[#1E3A5F]">{selected.fullName}</div>
                    <div className="text-xs text-[#4A4A4A]/70">
                      {selected.branch ?? '—'}{selected.countryOfPosting && ` · ${selected.countryOfPosting}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-xs text-[#4A4A4A]/60 hover:text-[#1E3A5F] underline"
                  >
                    Change
                  </button>
                </div>

                <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Note (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={submitting}
                  placeholder="Anything worth recording about this specific officer-case interaction…"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
                />
              </>
            )}

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              {selected && (
                <button type="button" onClick={handleSubmit} disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#F3CE49] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                  {submitting ? 'Linking…' : 'Link officer'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
