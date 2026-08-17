'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowLeft, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { getCountryName, countryCodeToFlagEmoji } from '@/lib/country-codes';

// PR-PROVIDER-PORTAL slice C — an institution uploading its own spreadsheets.
//
// The staff version of this screen (PricingImportSection) with two changes:
//
//  1. NO INSTITUTION PICKER. Staff choose whose sheet this is; an institution
//     cannot, and the API would ignore them if they tried — the target comes
//     from their session, never from this component.
//  2. The ending is different. Staff used to be told rows were live immediately;
//     since the review gate, nobody's upload goes straight to students. For an
//     institution that is the first surprising thing about this screen, so it is
//     said before they upload, not only after.
//
// Two steps, same as staff: "Check the file" runs the backend's dry run and
// nothing is written until "Send for review" is pressed.

type Kind = 'tuition' | 'scholarships' | 'programmes';

interface CountryTally { countryCode: string; countryLabel: string; count: number }
interface ReviewItem { sourceRow: number; reason: string; raw: string; suggestion?: string }
interface Result {
  detected?: CountryTally[];
  rows?: unknown[];
  needsReview?: ReviewItem[];
  skipped?: number;
  created?: number;
  updated?: number;
  unmapped?: string[];
}

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.xlsx';

const REASON_TEXT: Record<string, string> = {
  UNRECOGNISED_COUNTRY: 'Country name not recognised',
  NO_COUNTRY_CONTEXT: 'No country for this row',
  MISSING_NAME: 'No scholarship name',
  MISSING_OR_INVALID_AMOUNT: 'Amount missing or unreadable',
  PERCENTAGE_NOT_VALID_FOR_TUITION: 'Tuition can’t be a percentage',
  UNMAPPED_LEVEL: 'Study level not recognised',
};

const KIND_COPY: Record<Kind, { title: string; blurb: string; noun: string; path: string }> = {
  tuition: {
    title: 'Tuition fees',
    blurb:
      'Upload your fee sheet. Fees often differ by student nationality, so list each country’s rate — we read the country names straight from your sheet.',
    noun: 'fee',
    path: 'tuition',
  },
  scholarships: {
    title: 'Scholarships',
    blurb:
      'Upload your scholarship sheet. A student can hold more than one, so list every award you offer and the countries it applies to.',
    noun: 'scholarship',
    path: 'scholarships',
  },
  programmes: {
    title: 'Programmes',
    blurb:
      'Upload your programme list — names, levels, campuses, intakes and entry requirements. If a programme is already listed, the sheet updates it.',
    noun: 'programme',
    path: 'programmes',
  },
};

export function ProviderImportSection() {
  const [kind, setKind] = useState<Kind>('tuition');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'check' | 'commit' | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const copy = KIND_COPY[kind];

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
    if (!/\.xlsx$/i.test(f.name)) {
      toast.error('Please choose an Excel .xlsx file.');
      return;
    }
    setFile(f);
  };

  const send = async (step: 'check' | 'apply') => {
    if (!file) return;
    setBusy(step === 'check' ? 'check' : 'commit');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<Result>(`/provider/imports/${copy.path}/${step}`, fd);
      if (step === 'check') {
        setPreview(r);
      } else {
        setDone(r);
        setPreview(null);
        toast.success('Sent to Sorena for review.');
      }
    } catch (e: any) {
      toast.error(e?.message ?? (step === 'check' ? 'That file couldn’t be read.' : 'The upload didn’t save.'));
    } finally {
      setBusy(null);
    }
  };

  // The programme importer reports counts; the pricing importers report parsed rows.
  const readyCount = preview?.rows?.length ?? preview?.created ?? 0;
  const flagged = preview?.needsReview ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Upload your spreadsheets</h2>
          <p className="mt-1 text-xs text-gray-500">
            You’ll see exactly what we found in the file before anything is sent.
          </p>
        </div>

        {/* Said BEFORE the upload, not only after it. */}
        <div className="flex items-start gap-2.5 rounded-xl border border-[#c9a961]/40 bg-[#faf8f3] p-3.5">
          <Clock3 size={16} className="mt-0.5 shrink-0 text-[#8a6d10]" />
          <p className="text-xs leading-relaxed text-gray-700">
            <strong className="text-[#1e3a5f]">Everything you upload is checked by our team first.</strong>{' '}
            Your fees, scholarships and programmes are reviewed by Sorena before students can see them, so they
            won’t appear straight away. We’ll be in touch if anything needs clarifying.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist">
          {(['tuition', 'scholarships', 'programmes'] as Kind[]).map((k) => (
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
                onClick={() => send('check')}
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
                Nothing has been sent yet — here’s what’s in your file.
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {readyCount} {copy.noun}{readyCount === 1 ? '' : 's'} ready
                {flagged.length > 0 && ` · ${flagged.length} need${flagged.length === 1 ? 's' : ''} a look`}
              </p>
            </div>

            {preview.detected && preview.detected.length > 0 && (
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

            {flagged.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8a6d10]">
                  <AlertTriangle size={13} /> Skipped — please check these rows
                </p>
                <ul className="space-y-1.5">
                  {flagged.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-white px-3 py-2 text-xs">
                      <span className="font-semibold text-[#1e3a5f]">Row {r.sourceRow}</span>
                      <span className="text-gray-600">{REASON_TEXT[r.reason] ?? r.reason}</span>
                      {r.raw && r.raw !== '(blank)' && <span className="text-gray-400">“{r.raw}”</span>}
                      {r.suggestion && <span className="text-[#15a86b]">did you mean “{r.suggestion}”?</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-500">
                  These rows won’t be sent. Correct them in your spreadsheet and upload it again.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-[#c9a961]/30 pt-3 sm:flex-row">
              <button
                onClick={() => send('apply')}
                disabled={readyCount === 0 || busy !== null}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50"
              >
                {busy === 'commit' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {busy === 'commit'
                  ? 'Sending…'
                  : `Send ${readyCount} ${copy.noun}${readyCount === 1 ? '' : 's'} for review`}
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
              <CheckCircle2 size={16} /> Received — thank you
            </p>
            <p className="text-xs leading-relaxed text-gray-600">
              {(done.created ?? 0) + (done.updated ?? 0)} {copy.noun}
              {(done.created ?? 0) + (done.updated ?? 0) === 1 ? '' : 's'} came through
              {done.needsReview && done.needsReview.length > 0
                ? ` · ${done.needsReview.length} row${done.needsReview.length === 1 ? '' : 's'} skipped and still need a look`
                : ''}
              . Our team is reviewing them now, and they’ll go live for students once that’s done.
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
