'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, PencilLine, CheckCircle2, Clock3, Eye, EyeOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-PROVIDER-PORTAL slice D — an institution's own programmes.
//
// Three states are shown, not two, because "not visible to students" has two
// completely different causes and one fix each: waiting on us, or switched off by
// them. Collapsing those into "inactive" would have institutions emailing to ask
// why an approved programme is hidden.
//
// There is no delete button because there is no delete route: a student's
// recorded programme choice must survive an institution tidying its catalogue.
// "Stop offering" is the honest label for what deactivation does.

const LEVELS = [
  'CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
  'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD',
] as const;
const LEVEL_LABEL: Record<string, string> = {
  CERTIFICATE: 'Certificate', DIPLOMA: 'Diploma', GRADUATE_CERTIFICATE: 'Graduate certificate',
  GRADUATE_DIPLOMA: 'Graduate diploma', BACHELOR: 'Bachelor’s', POSTGRADUATE_CERTIFICATE: 'Postgraduate certificate',
  POSTGRADUATE_DIPLOMA: 'Postgraduate diploma', MASTER: 'Master’s', PHD: 'Doctorate',
};
const NZQF = ['LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Programme {
  id: string; name: string; level: string; nzqfLevel: string; intakeMonths: number[];
  campusCity: string | null; durationMonths: number | null; tuitionFeeNZD: number | null;
  programmeUrl: string | null; descriptionEn: string | null;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; isActive: boolean;
}
interface ListResponse {
  programmes: Programme[];
  counts: { total: number; live: number; awaitingReview: number };
}

type Draft = {
  name: string; level: string; nzqfLevel: string; intakeMonths: number[];
  campusCity: string; durationMonths: string; tuitionFeeNZD: string; programmeUrl: string;
};
const EMPTY: Draft = {
  name: '', level: 'BACHELOR', nzqfLevel: 'LEVEL_7', intakeMonths: [],
  campusCity: '', durationMonths: '', tuitionFeeNZD: '', programmeUrl: '',
};

export function ProviderProgrammes() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ListResponse>('/provider/programmes')
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Couldn’t load your programmes.'));
  }, []);
  useEffect(load, [load]);

  const openNew = () => { setDraft(EMPTY); setEditing('new'); };
  const openEdit = (p: Programme) => {
    setDraft({
      name: p.name, level: p.level, nzqfLevel: p.nzqfLevel, intakeMonths: p.intakeMonths ?? [],
      campusCity: p.campusCity ?? '', durationMonths: p.durationMonths?.toString() ?? '',
      tuitionFeeNZD: p.tuitionFeeNZD?.toString() ?? '', programmeUrl: p.programmeUrl ?? '',
    });
    setEditing(p.id);
  };

  const save = async () => {
    if (!draft.name.trim()) return toast.error('Give the programme a name.');
    if (draft.intakeMonths.length === 0) return toast.error('Choose at least one intake month.');
    setBusy('save');
    // Only send what was filled in — an empty optional field is "not stated",
    // not "set this to empty".
    const body: Record<string, unknown> = {
      name: draft.name.trim(), level: draft.level, nzqfLevel: draft.nzqfLevel,
      intakeMonths: [...draft.intakeMonths].sort((a, b) => a - b),
    };
    if (draft.campusCity.trim()) body.campusCity = draft.campusCity.trim();
    if (draft.durationMonths) body.durationMonths = Number(draft.durationMonths);
    if (draft.tuitionFeeNZD) body.tuitionFeeNZD = Number(draft.tuitionFeeNZD);
    if (draft.programmeUrl.trim()) body.programmeUrl = draft.programmeUrl.trim();

    try {
      if (editing === 'new') {
        await api.post('/provider/programmes', body);
        toast.success('Added — our team will review it before students see it.');
      } else {
        const before = data?.programmes.find((p) => p.id === editing);
        await api.patch(`/provider/programmes/${editing}`, body);
        toast.success(
          before?.reviewStatus === 'APPROVED'
            ? 'Saved — because the details changed, it goes back to us for a quick check.'
            : 'Saved.',
        );
      }
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That didn’t save.');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (p: Programme) => {
    setBusy(p.id);
    try {
      await api.patch(`/provider/programmes/${p.id}/active`, { active: !p.isActive });
      toast.success(p.isActive ? 'Stopped offering this programme.' : 'This programme is being offered again.');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That didn’t change.');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="flex items-center gap-2 py-16 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-sorena-navy">Your programmes</h1>
          <p className="mt-0.5 text-sm text-sorena-text/60">
            {data.counts.total === 0
              ? 'Nothing on file yet.'
              : `${data.counts.live} shown to students · ${data.counts.awaitingReview} with us for review`}
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a]"
        >
          <Plus size={16} /> Add a programme
        </button>
      </div>

      {editing && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
                {editing === 'new' ? 'New programme' : 'Edit programme'}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="Close" className="text-gray-400 hover:text-sorena-navy">
                <X size={18} />
              </button>
            </div>

            <Field label="Programme name">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={INPUT} placeholder="Bachelor of Nursing" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Study level">
                <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} className={INPUT}>
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </select>
              </Field>
              <Field label="NZQF level">
                <select value={draft.nzqfLevel} onChange={(e) => setDraft({ ...draft, nzqfLevel: e.target.value })} className={INPUT}>
                  {NZQF.map((l) => <option key={l} value={l}>Level {l.replace('LEVEL_', '')}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Intake months">
              <div className="flex flex-wrap gap-1.5">
                {MONTHS.map((m, i) => {
                  const month = i + 1;
                  const on = draft.intakeMonths.includes(month);
                  return (
                    <button key={m} type="button" aria-pressed={on}
                      onClick={() => setDraft({
                        ...draft,
                        intakeMonths: on ? draft.intakeMonths.filter((x) => x !== month) : [...draft.intakeMonths, month],
                      })}
                      className={`min-h-[40px] w-[52px] rounded-lg border text-xs font-semibold transition ${
                        on ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-200 bg-white text-[#1e3a5f] hover:bg-[#1e3a5f]/5'
                      }`}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Campus / city"><input value={draft.campusCity} onChange={(e) => setDraft({ ...draft, campusCity: e.target.value })} className={INPUT} placeholder="Auckland" /></Field>
              <Field label="Length (months)"><input inputMode="numeric" value={draft.durationMonths} onChange={(e) => setDraft({ ...draft, durationMonths: e.target.value.replace(/\D/g, '') })} className={INPUT} placeholder="36" /></Field>
              <Field label="Tuition (NZD)"><input inputMode="numeric" value={draft.tuitionFeeNZD} onChange={(e) => setDraft({ ...draft, tuitionFeeNZD: e.target.value.replace(/[^\d.]/g, '') })} className={INPUT} placeholder="32000" /></Field>
            </div>

            <Field label="Programme page (link)">
              <input value={draft.programmeUrl} onChange={(e) => setDraft({ ...draft, programmeUrl: e.target.value })} className={INPUT} placeholder="https://…" />
            </Field>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={save} disabled={busy !== null}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {editing === 'new' ? 'Add programme' : 'Save changes'}
              </button>
              <button onClick={() => setEditing(null)} disabled={busy !== null}
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-gray-200 px-5 text-sm font-semibold text-[#1e3a5f] hover:bg-white disabled:opacity-50">
                Cancel
              </button>
            </div>
            {editing !== 'new' && data.programmes.find((p) => p.id === editing)?.reviewStatus === 'APPROVED' && (
              <p className="text-xs text-gray-500">
                This programme has been checked by our team. If you change any of the details above, it comes back
                to us for another quick look before students see the new version.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {data.programmes.length === 0 && !editing && (
        <Card><CardContent className="p-8 text-center">
          <p className="text-sm font-semibold text-sorena-navy">No programmes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            Add them one at a time here, or upload your whole programme list as a spreadsheet from the main page.
          </p>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {data.programmes.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sorena-navy">{p.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {LEVEL_LABEL[p.level] ?? p.level} · Level {p.nzqfLevel.replace('LEVEL_', '')}
                  {p.campusCity ? ` · ${p.campusCity}` : ''}
                  {p.intakeMonths?.length ? ` · ${p.intakeMonths.map((m) => MONTHS[m - 1]).join(', ')}` : ''}
                </p>
              </div>
              <StatusChip programme={p} />
              <button onClick={() => openEdit(p)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3]">
                <PencilLine size={14} /> Edit
              </button>
              <button onClick={() => toggle(p)} disabled={busy === p.id}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3] disabled:opacity-50">
                {busy === p.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : p.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                {p.isActive ? 'Stop offering' : 'Offer again'}
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Three states, because "not visible" has two different causes and two different fixes. */
function StatusChip({ programme }: { programme: Programme }) {
  const [text, cls, Icon] = !programme.isActive
    ? ['Not being offered', 'border-gray-200 bg-gray-50 text-gray-600', EyeOff]
    : programme.reviewStatus === 'APPROVED'
      ? ['Shown to students', 'border-[#15a86b]/40 bg-[#15a86b]/5 text-[#15a86b]', CheckCircle2]
      : programme.reviewStatus === 'REJECTED'
        ? ['Needs a conversation', 'border-red-200 bg-red-50 text-red-600', Clock3]
        : ['With us for review', 'border-[#c9a961]/50 bg-[#faf8f3] text-[#8a6d10]', Clock3];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${cls}`}>
      <Icon size={13} /> {text}
    </span>
  );
}

const INPUT = 'min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm text-sorena-navy focus:border-[#1e3a5f] focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}
