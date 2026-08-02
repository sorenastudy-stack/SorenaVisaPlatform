'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronUp, ChevronDown, Trash2, AlertTriangle, Star, Check } from 'lucide-react';
import { useAdmission } from '../AdmissionFormContext';
import { api, ApiError } from '@/lib/api';
import { useLocaleStore } from '@/lib/stores/localeStore';

interface Programme {
  id: string;
  name: string;
  providerName: string;
  // PR-SLOTRULES — provider institution type (drives the required-position UX) + the Owner
  // "Featured" pin (additive display only).
  institutionType: 'UNIVERSITY' | 'ITP' | 'PTE' | null;
  isFeatured: boolean;
  intakeMonths: number[];
  // PR-INTAKE-1 (Slice 2) — server-authoritative: only intakes inside the 5–12
  // month offer window, each flagged `conditional` when in a later calendar year.
  eligibleIntakes: { month: number; year: number; conditional: boolean }[];
}

interface IntakeOption {
  month: number;
  year: number;
  label: string;
  conditional: boolean;
}

// Gregorian month + year, localised — "March 2027" / "مارس ۲۰۲۷" (Persian month
// names + digits via fa-IR-u-ca-gregory). Keeps the Gregorian calendar (locked
// decision) so intakes line up with INZ / university dates.
type Loc = 'en' | 'fa';
function intakeLabel(month: number, year: number, locale: Loc): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-NZ', {
    month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// PR-SLOTRULES — institution-type display labels (student-facing vocabulary).
const TYPE_LABEL: Record<string, string> = { UNIVERSITY: 'University', ITP: 'Polytechnic', PTE: 'College' };
const typeLabel = (t: string | null | undefined) => (t ? TYPE_LABEL[t] ?? t : 'Unknown type');

interface MandatorySlot { position: number; institutionType: string }
interface ChoiceRules { enabled: boolean; mandatorySlots: MandatorySlot[] }

// PR-INTAKE-1 (Slice 2) — intake options come from the SERVER's eligible list
// (already 5–12 month window-filtered), mapped to localised labels here.
function toIntakeOptions(
  eligible: { month: number; year: number; conditional: boolean }[],
  locale: Loc,
): IntakeOption[] {
  return eligible.map((e) => ({
    month: e.month, year: e.year, conditional: e.conditional,
    label: intakeLabel(e.month, e.year, locale),
  }));
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const selected          = options.find(o => o.value === value);
  const inputValue        = open ? query : (selected?.label ?? '');
  const filtered          = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => { setQuery(e.target.value); onChange(''); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none disabled:bg-gray-50 disabled:text-sorena-navy/40"
      />
      {open && !disabled && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-sorena-navy/20 bg-white shadow-lg">
          {filtered.map(opt => (
            <li
              key={opt.value}
              onMouseDown={() => { onChange(opt.value); setQuery(''); setOpen(false); }}
              className={[
                'cursor-pointer px-3 py-2 text-sm text-sorena-navy hover:bg-sorena-navy/5',
                opt.value === value ? 'bg-sorena-navy/5 font-medium' : '',
              ].join(' ')}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
      {open && !disabled && filtered.length === 0 && query && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2 text-sm text-sorena-navy/50 shadow-lg">
          {t('admissionStep1NoResults')}
        </div>
      )}
    </div>
  );
}

export function Step1Study() {
  const t = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  const { programmeChoices, addProgrammeChoice, removeProgrammeChoice, reorderProgrammeChoices } =
    useAdmission();

  const [programmes, setProgrammes]                   = useState<Programme[]>([]);
  const [loadingProgs, setLoadingProgs]               = useState(true);
  const [selectedProgId, setSelectedProgId]           = useState('');
  const [selectedIntakeMonth, setSelectedIntakeMonth] = useState<number | null>(null);
  const [selectedIntakeYear, setSelectedIntakeYear]   = useState<number | null>(null);
  const [adding, setAdding]                           = useState(false);
  const [reordering, setReordering]                   = useState(false);
  // PR-SLOTRULES — the live mandatory institution-type rule (Owner-configurable per country).
  const [choiceRules, setChoiceRules]                 = useState<ChoiceRules>({ enabled: false, mandatorySlots: [] });

  useEffect(() => {
    api.get<Programme[]>('/public/programmes')
      .then(setProgrammes)
      .catch(() => toast.error(t('admissionStep1ProgrammesLoadError')))
      .finally(() => setLoadingProgs(false));
  }, [t]);

  useEffect(() => {
    api.get<ChoiceRules>('/public/programme-choice-rules').then(setChoiceRules).catch(() => {});
  }, []);

  // correction 1: exclude already-chosen programmes from picker
  const chosenProgIds      = new Set(programmeChoices.map(c => c.programmeId));
  const availableProgrammes = programmes.filter(p => !chosenProgIds.has(p.id));
  const featuredProgrammes  = availableProgrammes.filter(p => p.isFeatured);
  // Institution type for a chosen programme (join to the loaded catalogue).
  const progType = (programmeId: string) => programmes.find(x => x.id === programmeId)?.institutionType ?? null;
  const rulesActive = choiceRules.enabled && choiceRules.mandatorySlots.length > 0;

  const selectedProg  = programmes.find(p => p.id === selectedProgId);
  const intakeOptions = selectedProg ? toIntakeOptions(selectedProg.eligibleIntakes, locale) : [];
  const intakeValue   = selectedIntakeMonth && selectedIntakeYear
    ? `${selectedIntakeMonth}-${selectedIntakeYear}` : '';
  // PR-INTAKE-1 (Slice 2) — is the currently-picked intake a conditional offer?
  const selectedIntakeConditional = intakeOptions.some(
    (o) => o.month === selectedIntakeMonth && o.year === selectedIntakeYear && o.conditional,
  );
  // A programme is selected but has no offerable intake inside the window.
  const noIntakesInWindow = !!selectedProgId && intakeOptions.length === 0;
  const canAdd        = !!selectedProgId && !!selectedIntakeMonth && !!selectedIntakeYear && !adding;

  const handleAdd = async () => {
    if (!canAdd || !selectedIntakeMonth || !selectedIntakeYear) return;
    setAdding(true);
    try {
      await addProgrammeChoice({
        programmeId: selectedProgId,
        intakeMonth: selectedIntakeMonth,
        intakeYear:  selectedIntakeYear,
      });
      setSelectedProgId('');
      setSelectedIntakeMonth(null);
      setSelectedIntakeYear(null);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 409) {
        toast.error(t('admissionStep1AddDuplicate'));
      } else {
        toast.error(t('admissionStep1AddError'));
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (choiceId: string) => {
    try {
      await removeProgrammeChoice(choiceId);
    } catch {
      toast.error(t('admissionStep1RemoveError'));
    }
  };

  const handleMove = async (idx: number, dir: 'up' | 'down') => {
    const sorted = [...programmeChoices].sort((a, b) => a.priority - b.priority);
    const next   = dir === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= sorted.length) return;
    [sorted[idx], sorted[next]] = [sorted[next], sorted[idx]];
    setReordering(true);
    try {
      await reorderProgrammeChoices(sorted.map(c => c.id));
    } catch {
      toast.error(t('admissionStep1ReorderError'));
    } finally {
      setReordering(false);
    }
  };

  const getProgLabel = (programmeId: string) => {
    const p = programmes.find(x => x.id === programmeId);
    return p ? `${p.providerName} — ${p.name}` : programmeId;
  };

  const sorted = [...programmeChoices].sort((a, b) => a.priority - b.priority);

  return (
    <div className="flex flex-col gap-6">
      {/* Heading */}
      <div>
        <h2 className="text-lg font-bold text-sorena-navy">{t('admissionStep1Title')}</h2>
      </div>

      {/* Welcome block */}
      <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-5">
        <h3 className="text-lg font-bold text-sorena-navy">{t('admissionStep1WelcomeTitle')}</h3>
        <p className="text-base leading-relaxed text-sorena-navy/80">{t('admissionStep1WelcomeIntro')}</p>
        <div className="flex flex-col gap-3">
          <p className="text-base leading-relaxed text-sorena-navy/80">{t('admissionStep1DocumentsIntro')}</p>
          <ul className="list-disc space-y-1 ps-6 text-base text-sorena-navy/80">
            <li>{t('admissionStep1Doc1')}</li>
            <li>{t('admissionStep1Doc2')}</li>
            <li>{t('admissionStep1Doc3')}</li>
            <li>{t('admissionStep1Doc4')}</li>
          </ul>
          <p className="text-base leading-relaxed text-sorena-navy/80">{t('admissionStep1DocumentsClosing')}</p>
        </div>
        <div>
          <h3 className="text-lg font-bold text-sorena-navy">{t('admissionStep1ProgrammeSectionTitle')}</h3>
          <p className="mt-1 text-base leading-relaxed text-sorena-navy/80">{t('admissionStep1ProgrammeSectionIntro')}</p>
        </div>
      </div>

      {/* Helper */}
      <p className="text-sm text-sorena-navy/60">{t('admissionStep1Helper')}</p>

      {/* PR-SLOTRULES — Featured institutions. Additive: shown ALONGSIDE the normal picker,
          never replacing a ranked/matched position. */}
      {featuredProgrammes.length > 0 && (
        <div className="rounded-xl border border-[#c9a961]/40 bg-[#c9a961]/5 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#8a6d10]">
            <Star size={15} /> Featured institutions
          </div>
          <p className="mb-2.5 text-xs text-sorena-navy/60">Highlighted by Sorena. Tap one to select it below, then choose an intake.</p>
          <div className="flex flex-wrap gap-2">
            {featuredProgrammes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedProgId(p.id); setSelectedIntakeMonth(null); setSelectedIntakeYear(null); }}
                className="rounded-full border border-[#c9a961]/50 bg-white px-3 py-1 text-xs text-sorena-navy transition-colors hover:bg-[#c9a961]/10"
              >
                {p.providerName} — {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Picker card */}
      <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Programme */}
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep1ProgrammeLabel')}
            </label>
            {loadingProgs ? (
              <div className="h-10 animate-pulse rounded-lg bg-sorena-navy/5" />
            ) : (
              <SearchableSelect
                options={availableProgrammes.map(p => ({
                  value: p.id,
                  label: `${p.providerName} — ${p.name}`,
                }))}
                value={selectedProgId}
                onChange={(v) => {
                  setSelectedProgId(v);
                  setSelectedIntakeMonth(null);
                  setSelectedIntakeYear(null);
                }}
                placeholder={t('admissionStep1ProgrammePlaceholder')}
              />
            )}
          </div>

          {/* Intake */}
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep1IntakeLabel')}
            </label>
            <select
              value={intakeValue}
              onChange={(e) => {
                const [m, y] = e.target.value.split('-').map(Number);
                setSelectedIntakeMonth(m || null);
                setSelectedIntakeYear(y || null);
              }}
              disabled={!selectedProgId || intakeOptions.length === 0}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none disabled:bg-gray-50 disabled:text-sorena-navy/40"
            >
              <option value="">{t('admissionStep1IntakePlaceholder')}</option>
              {intakeOptions.map(o => (
                <option key={`${o.month}-${o.year}`} value={`${o.month}-${o.year}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* PR-INTAKE-1 (Slice 2) — inline English (no t() key → keeps Persian frozen,
            same pattern as ClientShell/StaffSidebar). */}
        {noIntakesInWindow && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No intake dates are currently available for this programme within the application window. Please choose another programme, or check back later.
          </p>
        )}
        {selectedIntakeConditional && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>This intake is in {selectedIntakeYear} — any offer for it is <strong>conditional on the institution&apos;s acceptance</strong>.</span>
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className="self-end rounded-lg bg-sorena-navy px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {adding ? t('admissionStep1Adding') : t('admissionStep1AddButton')}
        </button>
      </div>

      {/* PR-SLOTRULES — required mandatory institution-type positions (live config). Shows the
          student what they must place where, and whether each is satisfied, before submit. */}
      {rulesActive && (
        <div className="rounded-xl border border-sorena-navy/10 bg-white p-4">
          <p className="mb-1 text-sm font-bold text-sorena-navy">Required positions</p>
          <p className="mb-2.5 text-xs text-sorena-navy/60">Your list must place these institution types at these priorities before you can submit. Every other position can be anything.</p>
          <ul className="space-y-1">
            {[...choiceRules.mandatorySlots].sort((a, b) => a.position - b.position).map((m) => {
              const at = sorted[m.position - 1];
              const met = !!at && progType(at.programmeId) === m.institutionType;
              return (
                <li key={m.position} className="flex items-center gap-2 text-sm">
                  {met
                    ? <Check size={15} className="shrink-0 text-[#15a86b]" />
                    : <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-amber-400" />}
                  <span className={met ? 'text-sorena-navy/70' : 'text-amber-800'}>
                    Priority {m.position} must be a <strong>{typeLabel(m.institutionType)}</strong>{met ? '' : ' — not set yet'}.
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Choices list */}
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sorena-navy/20 py-8 text-center text-sm text-sorena-navy/50">
          {t('admissionStep1EmptyState')}
        </p>
      ) : (
        <div className="flex flex-col gap-2" title={t('admissionStep1ReorderHint')}>
          {sorted.map((choice, idx) => (
            <div
              key={choice.id}
              className="flex items-center gap-3 rounded-xl border border-sorena-navy/10 bg-white p-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sorena-navy text-xs font-bold text-white">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sorena-navy">
                  {getProgLabel(choice.programmeId)}
                  {progType(choice.programmeId) && (
                    <span className="ms-2 rounded bg-sorena-navy/5 px-1.5 py-0.5 text-[11px] font-normal text-sorena-navy/60">
                      {typeLabel(progType(choice.programmeId))}
                    </span>
                  )}
                </p>
                <p className="text-sm text-sorena-navy/50">
                  {intakeLabel(choice.intakeMonth, choice.intakeYear, locale)}
                </p>
                {(() => {
                  const m = choiceRules.mandatorySlots.find((x) => x.position === idx + 1);
                  return rulesActive && m && progType(choice.programmeId) !== m.institutionType
                    ? <p className="mt-0.5 text-[11px] text-amber-700">Priority {idx + 1} must be a {typeLabel(m.institutionType)}.</p>
                    : null;
                })()}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleMove(idx, 'up')}
                  disabled={idx === 0 || reordering}
                  title={t('admissionStep1MoveUp')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-sorena-navy/5 hover:text-sorena-navy disabled:opacity-25"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  onClick={() => handleMove(idx, 'down')}
                  disabled={idx === sorted.length - 1 || reordering}
                  title={t('admissionStep1MoveDown')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-sorena-navy/5 hover:text-sorena-navy disabled:opacity-25"
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  onClick={() => handleRemove(choice.id)}
                  title={t('admissionStep1RemoveTooltip')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
