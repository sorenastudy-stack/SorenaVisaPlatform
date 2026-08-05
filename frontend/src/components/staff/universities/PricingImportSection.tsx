'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { getCountryName, countryCodeToFlagEmoji } from '@/lib/country-codes';

// PR-EXPLORE (Rounds 2+3) — Owner upload for an institution's per-nationality
// TUITION and SCHOLARSHIP spreadsheets.
//
// Two-step on purpose: "Check the file" runs the backend dry-run (?dry=true) and
// shows what it found; NOTHING is written until the Owner presses "Confirm and
// import". A bad parse can never commit silently — the flagged rows are shown
// with their real Excel row numbers before the commit button is even offered.

type Kind = 'tuition' | 'scholarships';

interface CountryTally { countryCode: string; countryLabel: string; count: number }
interface ReviewItem { sourceRow: number; reason: string; raw: string; suggestion?: string }
interface Preview {
  detected: CountryTally[];
  rows: unknown[];
  needsReview: ReviewItem[];
  skippedRows: number;
  created?: number;
  updated?: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.xlsx,.xlsm,.xls';

// Plain-English, no shouting. Each explains what to do, not just what went wrong.
const REASON_TEXT: Record<string, string> = {
  UNRECOGNISED_COUNTRY: 'Country name not recognised',
  NO_COUNTRY_CONTEXT: 'No country for this row',
  MISSING_NAME: 'No scholarship name',
  MISSING_OR_INVALID_AMOUNT: 'Amount missing or unreadable',
  PERCENTAGE_NOT_VALID_FOR_TUITION: 'Tuition can’t be a percentage',
  UNMAPPED_LEVEL: 'Study level not recognised',
};

const KIND_COPY: Record<Kind, { title: string; blurb: string; noun: string }> = {
  tuition: {
    title: 'Tuition fees',
    blurb:
      'Upload this institution’s fee sheet. Fees can differ by country, so list each country’s rate — the system reads the country names straight from the sheet.',
    noun: 'fee',
  },
  scholarships: {
    title: 'Scholarships',
    blurb:
      'Upload this institution’s scholarship sheet. A student can hold more than one, so list every award — they’re added together for the student’s own country.',
    noun: 'scholarship',
  },
};

export function PricingImportSection({ providerId }: { providerId: string }) {
  const [kind, setKind] = useState<Kind>('tuition');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'check' | 'commit' | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const endpoint = `/providers/${providerId}/${kind === 'tuition' ? 'tuitions' : 'scholarships'}/import`;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDone(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (f: File | null) => {
    setPreview(null);
    setDone(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      toast.error(`That file is ${Math.round(f.size / 1024 / 1024)} MB. Please keep it under 5 MB.`);
      return;
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      toast.error('Please choose an Excel file (.xlsx, .xlsm or .xls).');
      return;
    }
    setFile(f);
  };

  const check = async () => {
    if (!file) return;
    setBusy('check');
    try {
      const fd = new FormData();
      fd.append('file', file);
      setPreview(await api.upload<Preview>(`${endpoint}?dry=true`, fd));
    } catch (e: any) {
      toast.error(e?.message ?? 'That file couldn’t be read.');
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy('commit');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<Preview>(endpoint, fd);
      setDone(r);
      setPreview(null);
      toast.success(`Saved. ${(r.created ?? 0) + (r.updated ?? 0)} ${KIND_COPY[kind].noun}${(r.created ?? 0) + (r.updated ?? 0) === 1 ? '' : 's'} are now live.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'The import didn’t save.');
    } finally {
      setBusy(null);
    }
  };

  const copy = KIND_COPY[kind];
  const readyCount = preview?.rows.length ?? 0;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Fees and scholarships (Excel)</h3>
          <p className="mt-1 text-xs text-gray-500">
            Upload one sheet per institution. You’ll see what was found before anything is saved.
          </p>
        </div>

        {/* Which sheet — 48px tall targets */}
        <div className="flex gap-2" role="tablist">
          {(['tuition', 'scholarships'] as Kind[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => { setKind(k); reset(); }}
              className={`min-h-[48px] flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                kind === k
                  ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white'
                  : 'border-gray-200 bg-white text-[#1e3a5f] hover:bg-[#1e3a5f]/5'
              }`}
            >
              {KIND_COPY[k].title}
            </button>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-gray-600">{copy.blurb}</p>

        {/* ── Step 1: choose + check ── */}
        {!done && (
          <div className="space-y-3">
            <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 px-4 py-3 hover:border-[#1e3a5f]/40 hover:bg-[#faf8f3]">
              <FileSpreadsheet size={18} className="shrink-0 text-[#c9a961]" />
              <span className="text-sm text-gray-600">
                {file ? <strong className="text-[#1e3a5f]">{file.name}</strong> : 'Choose an Excel file…'}
              </span>
              <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
                onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </label>

            {!preview && (
              <button
                onClick={check}
                disabled={!file || busy !== null}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50 sm:w-auto"
              >
                {busy === 'check' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {busy === 'check' ? 'Reading the file…' : 'Check the file'}
              </button>
            )}
          </div>
        )}

        {/* ── Step 2: preview, then commit ── */}
        {preview && (
          <div className="space-y-4 rounded-xl border border-[#c9a961]/40 bg-[#faf8f3] p-4">
            <div>
              <p className="text-sm font-semibold text-[#1e3a5f]">
                Nothing has been saved yet — here’s what’s in the file.
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {readyCount} {copy.noun}{readyCount === 1 ? '' : 's'} ready to save
                {preview.needsReview.length > 0 && ` · ${preview.needsReview.length} need${preview.needsReview.length === 1 ? 's' : ''} a look`}
              </p>
            </div>

            {preview.detected.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Countries found</p>
                <div className="flex flex-wrap gap-2">
                  {preview.detected.map((d) => (
                    <span key={d.countryCode}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs">
                      <span aria-hidden>{countryCodeToFlagEmoji(d.countryCode)}</span>
                      <strong className="text-[#1e3a5f]">{getCountryName(d.countryCode, 'en') || d.countryLabel}</strong>
                      <span className="text-gray-500">{d.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {preview.needsReview.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8a6d10]">
                  <AlertTriangle size={13} /> Skipped — please check these rows
                </p>
                <ul className="space-y-1.5">
                  {preview.needsReview.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-white px-3 py-2 text-xs">
                      <span className="font-semibold text-[#1e3a5f]">Row {r.sourceRow}</span>
                      <span className="text-gray-600">{REASON_TEXT[r.reason] ?? r.reason}</span>
                      {r.raw && r.raw !== '(blank)' && <span className="text-gray-400">“{r.raw}”</span>}
                      {r.suggestion && (
                        <span className="text-[#15a86b]">did you mean “{r.suggestion}”?</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-500">
                  These rows won’t be saved. Fix them in the spreadsheet and upload again, or add them by hand below.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-[#c9a961]/30 pt-3 sm:flex-row">
              <button
                onClick={commit}
                disabled={readyCount === 0 || busy !== null}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50"
              >
                {busy === 'commit' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {busy === 'commit' ? 'Saving…' : `Confirm and import ${readyCount} ${copy.noun}${readyCount === 1 ? '' : 's'}`}
              </button>
              <button
                onClick={reset}
                disabled={busy !== null}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-[#1e3a5f] hover:bg-white disabled:opacity-50"
              >
                <ArrowLeft size={16} /> Choose another file
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: done ── */}
        {done && (
          <div className="space-y-3 rounded-xl border border-[#15a86b]/40 bg-[#15a86b]/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#15a86b]">
              <CheckCircle2 size={16} /> Saved
            </p>
            <p className="text-xs text-gray-600">
              {done.created ?? 0} added{done.updated ? `, ${done.updated} updated` : ''}
              {done.needsReview.length > 0 && ` · ${done.needsReview.length} row${done.needsReview.length === 1 ? '' : 's'} skipped and still need a look`}.
              Students see these straight away, matched to their own country.
            </p>
            <button onClick={reset}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-sm font-semibold text-[#1e3a5f] hover:bg-[#faf8f3]">
              Upload another sheet
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
