'use client';

import { useState } from 'react';
import { ImageIcon, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-EXPLORE (Round 2) — Owner-uploadable cover image per programme, shown on the
// Explore map result cards and the programme detail page.
//
// Client-side limits MIRROR the backend (JPG/PNG/WebP, 2 MB) so the Owner gets an
// instant, plain-English answer instead of a round-trip 400. The backend remains
// the authority — this is a courtesy check, not the guard.

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

interface Programme {
  id: string;
  name: string;
  level: string;
  coverImageUrl?: string | null;
}

export function ProgrammeCoversSection({ programmes }: { programmes: Programme[] }) {
  // Local echo of what's been uploaded this session, so the row updates without a refetch.
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const upload = async (programmeId: string, file: File | null) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Please choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please keep it under 2 MB.`);
      return;
    }
    setBusyId(programmeId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<{ id: string; coverImageUrl: string | null }>(
        `/providers/programmes/${programmeId}/cover-image`,
        fd,
      );
      setCovers((c) => ({ ...c, [programmeId]: r.coverImageUrl ?? '' }));
      toast.success('Cover image saved. Students will see it on this course.');
    } catch (e: any) {
      toast.error(e?.message ?? 'That image didn’t upload.');
    } finally {
      setBusyId(null);
    }
  };

  if (!programmes.length) {
    return (
      <Card><CardContent className="p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Course cover images</h3>
        <p className="mt-1 text-xs text-gray-500">Add courses first — then you can give each one a photo.</p>
      </CardContent></Card>
    );
  }

  return (
    <Card><CardContent className="p-5 space-y-3">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Course cover images</h3>
        <p className="mt-1 text-xs text-gray-500">
          One photo per course, shown on the map results and the course page. JPG, PNG or WebP, up to 2&nbsp;MB.
        </p>
      </div>

      <ul className="divide-y divide-gray-100">
        {programmes.map((p) => {
          const current = covers[p.id] ?? p.coverImageUrl ?? null;
          const busy = busyId === p.id;
          return (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-[#faf8f3]">
                {current
                  ? <CheckCircle2 size={18} className="text-[#15a86b]" aria-label="Cover image set" />
                  : <ImageIcon size={18} className="text-gray-300" aria-label="No cover image yet" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1e3a5f]">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {current ? 'Photo added' : 'No photo yet'}
                </p>
              </div>

              <label
                className={`inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                  busy
                    ? 'border-gray-200 text-gray-400'
                    : 'border-[#1e3a5f]/25 text-[#1e3a5f] hover:bg-[#1e3a5f]/5'
                }`}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
                {busy ? 'Uploading…' : current ? 'Replace photo' : 'Add photo'}
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  disabled={busy}
                  data-testid={`cover-input-${p.id}`}
                  onChange={(e) => { upload(p.id, e.target.files?.[0] ?? null); e.target.value = ''; }}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </CardContent></Card>
  );
}
