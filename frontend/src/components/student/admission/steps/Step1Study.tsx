'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { useAdmission } from '../AdmissionFormContext';
import { api, ApiError } from '@/lib/api';

interface Programme {
  id: string;
  name: string;
  providerName: string;
  intakeMonths: number[];
}

interface IntakeOption {
  month: number;
  year: number;
  label: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function upcomingIntakes(intakeMonths: number[]): IntakeOption[] {
  const now   = new Date();
  const curYr = now.getFullYear();
  const curMo = now.getMonth() + 1;
  const out: IntakeOption[] = [];
  for (let yr = curYr; yr <= curYr + 2; yr++) {
    for (const m of [...intakeMonths].sort((a, b) => a - b)) {
      if (yr === curYr && m < curMo) continue;
      out.push({ month: m, year: yr, label: `${MONTH_NAMES[m - 1]} ${yr}` });
    }
  }
  return out;
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
          No results
        </div>
      )}
    </div>
  );
}

export function Step1Study() {
  const t = useTranslations();
  const { programmeChoices, addProgrammeChoice, removeProgrammeChoice, reorderProgrammeChoices } =
    useAdmission();

  const [programmes, setProgrammes]                   = useState<Programme[]>([]);
  const [loadingProgs, setLoadingProgs]               = useState(true);
  const [selectedProgId, setSelectedProgId]           = useState('');
  const [selectedIntakeMonth, setSelectedIntakeMonth] = useState<number | null>(null);
  const [selectedIntakeYear, setSelectedIntakeYear]   = useState<number | null>(null);
  const [adding, setAdding]                           = useState(false);
  const [reordering, setReordering]                   = useState(false);

  useEffect(() => {
    api.get<Programme[]>('/public/programmes')
      .then(setProgrammes)
      .catch(() => toast.error(t('admissionStep1ProgrammesLoadError')))
      .finally(() => setLoadingProgs(false));
  }, [t]);

  // correction 1: exclude already-chosen programmes from picker
  const chosenProgIds      = new Set(programmeChoices.map(c => c.programmeId));
  const availableProgrammes = programmes.filter(p => !chosenProgIds.has(p.id));

  const selectedProg  = programmes.find(p => p.id === selectedProgId);
  const intakeOptions = selectedProg ? upcomingIntakes(selectedProg.intakeMonths) : [];
  const intakeValue   = selectedIntakeMonth && selectedIntakeYear
    ? `${selectedIntakeMonth}-${selectedIntakeYear}` : '';
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
        <h2 className="text-lg font-semibold text-sorena-navy">{t('admissionStep1Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep1Helper')}</p>
      </div>

      {/* Picker card */}
      <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Programme */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-sorena-navy/50">
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
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-sorena-navy/50">
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

        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className="self-end rounded-lg bg-sorena-navy px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {adding ? 'Adding…' : t('admissionStep1AddButton')}
        </button>
      </div>

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
                </p>
                <p className="text-xs text-sorena-navy/50">
                  {MONTH_NAMES[choice.intakeMonth - 1]} {choice.intakeYear}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleMove(idx, 'up')}
                  disabled={idx === 0 || reordering}
                  title="Move up"
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-sorena-navy/5 hover:text-sorena-navy disabled:opacity-25"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  onClick={() => handleMove(idx, 'down')}
                  disabled={idx === sorted.length - 1 || reordering}
                  title="Move down"
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
