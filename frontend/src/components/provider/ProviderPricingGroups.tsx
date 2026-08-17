'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, PencilLine, Archive, X, Clock3, CheckCircle2, EyeOff, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { getCountryName, countryCodeToFlagEmoji } from '@/lib/country-codes';
import { CountryMultiSelect } from '@/components/common/CountryMultiSelect';

// PR-PROVIDER-PORTAL slice E — country groups, and the rates attached to them.
//
// A group is a label the institution invented ("South Asia"), so it is NOT
// reviewed and the screen says nothing about review when you save one. The RATE
// attached to a group is money, so it is reviewed exactly like every other rate,
// and the screen says so before you enter one — the same pattern as the upload
// panel in slice C.
//
// Deleting a group that still has rates is refused by the API. Rather than
// letting someone press Delete and read an error, the button explains itself when
// rates are attached: the count comes back with the group.

interface Group {
  id: string;
  name: string;
  nationalities: string[];
  attachedRates: { tuitions: number; scholarships: number };
  /** The institution-wide default for this group — applies unless a programme overrides it. */
  defaultTuition: { amount: number; reviewStatus: string } | null;
  defaultScholarship: { amount: number; reviewStatus: string } | null;
}
interface RateRow {
  id: string;
  nationality: string | null;
  amountValue: number;
  currency: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  isActive: boolean;
  name?: string;
  amountType?: string;
  /** Null = the institution-wide default; set = an override for one programme. */
  programme: { id: string; name: string } | null;
  nationalityGroup: { id: string; name: string; nationalities: string[] } | null;
}

const CODE = /^[A-Za-z]{2}$/;

export function ProviderPricingGroups() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [rates, setRates] = useState<{ tuitions: RateRow[]; scholarships: RateRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [defTuition, setDefTuition] = useState('');
  const [defScholarship, setDefScholarship] = useState('');
  const [rateFor, setRateFor] = useState<Group | null>(null);
  const [rateKind, setRateKind] = useState<'tuition' | 'scholarship'>('tuition');
  const [rateAmount, setRateAmount] = useState('');
  const [rateName, setRateName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<{ groups: Group[] }>('/provider/nationality-groups'),
      api.get<{ tuitions: RateRow[]; scholarships: RateRow[] }>('/provider/nationality-groups/rates'),
    ])
      .then(([g, r]) => { setGroups(g.groups); setRates(r); })
      .catch((e) => setError(e?.message ?? 'Couldn’t load your country groups.'));
  }, []);
  useEffect(load, [load]);

  const openNew = () => { setName(''); setCodes([]); setDefTuition(''); setDefScholarship(''); setEditing('new'); };
  // Existing groups were created through the old comma-separated box; their
  // stored codes drop straight into the picker, which is why this stayed a UI
  // change with no data migration behind it.
  const openEdit = (g: Group) => {
    setName(g.name);
    setCodes(g.nationalities);
    setDefTuition(g.defaultTuition ? String(g.defaultTuition.amount) : '');
    setDefScholarship(g.defaultScholarship ? String(g.defaultScholarship.amount) : '');
    setEditing(g.id);
  };

  // Kept, even though the picker can only emit catalogue codes: it is the last
  // thing between the payload and the server, and "the UI cannot produce a bad
  // code" is a property of today's UI rather than of this function.
  const normalise = (raw: string[]) =>
    [...new Set(raw.map((c) => (c ?? '').trim().toUpperCase()).filter((c) => CODE.test(c)))];

  const saveGroup = async () => {
    const nationalities = normalise(codes);
    if (!name.trim()) return toast.error('Give the group a name.');
    if (nationalities.length === 0) return toast.error('Choose at least one country.');
    setBusy('group');
    try {
      // A blank field is sent as null — "clear this default" — rather than
      // omitted, because omission means "leave it alone" and the two are
      // different instructions.
      const body = {
        name: name.trim(),
        nationalities,
        defaultTuitionAmount: defTuition.trim() === '' ? null : Number(defTuition),
        defaultScholarshipAmount: defScholarship.trim() === '' ? null : Number(defScholarship),
      };
      if (editing === 'new') {
        await api.post('/provider/nationality-groups', body);
        toast.success('Group saved.');
      } else {
        await api.put(`/provider/nationality-groups/${editing}`, body);
        toast.success('Group updated. Any fees using it now apply to this list.');
      }
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That didn’t save.');
    } finally { setBusy(null); }
  };

  const removeGroup = async (g: Group) => {
    setBusy(g.id);
    try {
      await api.delete(`/provider/nationality-groups/${g.id}`);
      toast.success(`“${g.name}” archived. Its price history is kept.`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That group couldn’t be archived.');
    } finally { setBusy(null); }
  };

  /**
   * Clear one rate from the list it appears in.
   *
   * Before this the only way was to blank a field on a form — and only the right
   * form: the group's Edit form clears the institution-wide default, while a
   * per-programme override had to be found on its own programme. Since a group
   * cannot be archived while a rate is live, archiving was effectively
   * unreachable from the screen offering it.
   */
  const clearRate = async (r: RateRow) => {
    const kind = r.name ? 'scholarship' : 'tuition';
    const label = r.programme ? `${r.programme.name}` : 'your standard price';
    if (!window.confirm(
      `Stop applying this ${kind === 'tuition' ? 'fee' : 'scholarship'} for ${r.nationalityGroup?.name}`
      + `${r.programme ? ` on ${label}` : ''}?

Nothing will be deleted — we keep the record, it just stops applying.`,
    )) return;
    setBusy(r.id);
    try {
      await api.post(`/provider/nationality-groups/rates/${kind}/${r.id}/clear`, {});
      toast.success('Cleared. Nothing was deleted — the record is kept.');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That couldn’t be cleared.');
    } finally { setBusy(null); }
  };

  const saveRate = async () => {
    if (!rateFor) return;
    const amount = Number(rateAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter an amount in NZD.');
    if (rateKind === 'scholarship' && !rateName.trim()) return toast.error('Give the scholarship a name.');
    setBusy('rate');
    try {
      if (rateKind === 'tuition') {
        await api.post('/provider/nationality-groups/rates/tuition', { nationalityGroupId: rateFor.id, amountValue: amount });
      } else {
        await api.post('/provider/nationality-groups/rates/scholarship', { nationalityGroupId: rateFor.id, name: rateName.trim(), amountValue: amount });
      }
      toast.success('Sent to Sorena for review.');
      setRateFor(null); setRateAmount(''); setRateName('');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That didn’t save.');
    } finally { setBusy(null); }
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!groups || !rates) return <div className="flex items-center gap-2 py-16 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  const groupedRates = [...rates.tuitions, ...rates.scholarships].filter((r) => r.nationalityGroup);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-sorena-navy">Country groups</h1>
          <p className="mt-0.5 max-w-xl text-sm text-sorena-text/60">
            Group countries that share the same fee — then set one rate for the whole group instead of
            entering it country by country.
          </p>
        </div>
        <button onClick={openNew}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a]">
          <Plus size={16} /> New group
        </button>
      </div>

      {/* Groups are a label, not money — so this says nothing about review. */}
      {editing && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
                {editing === 'new' ? 'New group' : 'Edit group'}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="Close" className="text-gray-400 hover:text-sorena-navy"><X size={18} /></button>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Group name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="South Asia" />
            </label>
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Countries</span>
              {/* Search by name; the code is what gets stored. 250 is the cap the
                  server enforces, stated here so it is hit as a message rather
                  than a rejected save. */}
              <CountryMultiSelect value={codes} onChange={setCodes} max={250} />
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Default price for this group</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Optional. Applies to every one of your programmes unless you set a different price for
                that programme. Leave blank to charge your standard fees.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Tuition fee (NZD)</span>
                  <input inputMode="numeric" value={defTuition} placeholder="—"
                    onChange={(e) => setDefTuition(e.target.value.replace(/[^\d.]/g, ''))} className={INPUT} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Scholarship (NZD)</span>
                  <input inputMode="numeric" value={defScholarship} placeholder="—"
                    onChange={(e) => setDefScholarship(e.target.value.replace(/[^\d.]/g, ''))} className={INPUT} />
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Prices are checked by our team before students see them.
              </p>
            </div>

            {editing !== 'new' && (
              <p className="text-xs text-gray-500">
                Changing this list changes who any fee on this group applies to.
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={saveGroup} disabled={busy !== null}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                {busy === 'group' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Save group
              </button>
              <button onClick={() => setEditing(null)} disabled={busy !== null}
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-gray-200 px-5 text-sm font-semibold text-[#1e3a5f] hover:bg-white disabled:opacity-50">
                Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The rate form — money, so the review gate is stated up front. */}
      {rateFor && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
                Set a rate for “{rateFor.name}”
              </h2>
              <button onClick={() => setRateFor(null)} aria-label="Close" className="text-gray-400 hover:text-sorena-navy"><X size={18} /></button>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-[#c9a961]/40 bg-[#faf8f3] p-3.5">
              <Clock3 size={16} className="mt-0.5 shrink-0 text-[#8a6d10]" />
              <p className="text-xs leading-relaxed text-gray-700">
                <strong className="text-[#1e3a5f]">Rates are checked by our team first.</strong>{' '}
                This one will apply to all {rateFor.nationalities.length} countries in the group once it’s been
                reviewed, so it won’t appear to students straight away.
              </p>
            </div>

            <div className="flex gap-2" role="tablist">
              {(['tuition', 'scholarship'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={rateKind === k} onClick={() => setRateKind(k)}
                  className={`min-h-[48px] flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                    rateKind === k ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-200 bg-white text-[#1e3a5f] hover:bg-[#1e3a5f]/5'
                  }`}>
                  {k === 'tuition' ? 'Tuition fee' : 'Scholarship'}
                </button>
              ))}
            </div>

            {rateKind === 'scholarship' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Scholarship name</span>
                <input value={rateName} onChange={(e) => setRateName(e.target.value)} className={INPUT} placeholder="Regional Excellence Award" />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Amount (NZD)</span>
              <input inputMode="numeric" value={rateAmount} onChange={(e) => setRateAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className={INPUT} placeholder="25000" />
            </label>

            <button onClick={saveRate} disabled={busy !== null}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
              {busy === 'rate' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Send for review
            </button>
          </CardContent>
        </Card>
      )}

      {groups.length === 0 && !editing && (
        <Card><CardContent className="p-8 text-center">
          <p className="text-sm font-semibold text-sorena-navy">No country groups yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            If several countries pay the same fee, group them once and set the rate in one place.
          </p>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {groups.map((g) => {
          const attached = g.attachedRates.tuitions + g.attachedRates.scholarships;
          // Mirrors the server's rule: only rates that are still applied block
          // archiving. A cleared rate still references the group but is not in
          // front of anybody.
          const livePrices = groupedRates.filter((r) => r.nationalityGroup?.id === g.id && r.isActive).length;
          return (
            <Card key={g.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-sorena-navy">{g.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                      <Users size={12} /> {g.nationalities.length} countries
                      {attached > 0 && ` · ${attached} rate${attached === 1 ? '' : 's'} using it`}
                    </p>
                    {/* At a glance: is there a default, and is it live yet? */}
                    <p className="mt-1 text-xs">
                      {g.defaultTuition || g.defaultScholarship ? (
                        <span className="text-sorena-navy">
                          {g.defaultTuition && <>Tuition: <strong>${g.defaultTuition.amount.toLocaleString()}</strong></>}
                          {g.defaultTuition && g.defaultScholarship && ' · '}
                          {g.defaultScholarship && <>Scholarship: <strong>${g.defaultScholarship.amount.toLocaleString()}</strong></>}
                          {[g.defaultTuition, g.defaultScholarship].some((d) => d && d.reviewStatus !== 'APPROVED') && (
                            <span className="ms-1.5 text-[#8a6d10]">· with us for review</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">No default price set</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => { setRateFor(g); setRateAmount(''); setRateName(''); }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 text-xs font-semibold text-white hover:bg-[#162d4a]">
                    <Plus size={14} /> Set a rate
                  </button>
                  <button onClick={() => openEdit(g)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3]">
                    <PencilLine size={14} /> Edit
                  </button>
                  {/* "Archive", not "Delete" — the group leaves the list and its
                      prices stay exactly as they are. Blocked only while a price
                      is still LIVE, so clearing the prices now genuinely unlocks
                      it; previously any rate that had EVER existed blocked it
                      forever. */}
                  <button
                    onClick={() => removeGroup(g)}
                    disabled={busy === g.id || livePrices > 0}
                    title={livePrices > 0
                      ? 'Clear this group’s prices first — nothing will be deleted.'
                      : 'Archive: the group leaves this list, its price history is kept.'}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3] disabled:cursor-not-allowed disabled:opacity-40">
                    {busy === g.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />} Archive
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.nationalities.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs">
                      <span aria-hidden>{countryCodeToFlagEmoji(c)}</span>
                      <span className="text-gray-600">{getCountryName(c, 'en') || c}</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {groupedRates.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Rates set on a group</h2>
          {groupedRates.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-sorena-navy">
                    {r.name ?? 'Tuition fee'} — ${r.amountValue.toLocaleString()} {r.currency}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {r.nationalityGroup!.name} · {r.nationalityGroup!.nationalities.length} countries
                    {/* Which programme this applies to — the list mixes
                        institution-wide defaults with per-programme overrides,
                        and Clear needs to be aimable. */}
                    {r.programme ? ` · ${r.programme.name}` : ' · all programmes'}
                  </p>
                </div>
                {/* Three states, not two. A cleared price is still on the record
                    (nothing is deleted) but it is NOT waiting on us — calling it
                    "with us for review" contradicted the group above, which
                    correctly said no default was set. */}
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  !r.isActive
                    ? 'border-gray-200 bg-gray-50 text-gray-500'
                    : r.reviewStatus === 'APPROVED'
                      ? 'border-[#15a86b]/40 bg-[#15a86b]/5 text-[#15a86b]'
                      : 'border-[#c9a961]/50 bg-[#faf8f3] text-[#8a6d10]'
                }`}>
                  {!r.isActive
                    ? <><EyeOff size={13} /> Not applied</>
                    : r.reviewStatus === 'APPROVED'
                      ? <><CheckCircle2 size={13} /> Shown to students</>
                      : <><Clock3 size={13} /> With us for review</>}
                </span>
                {/* Only for rates that are actually applying — clearing a
                    already-cleared row would be a button that does nothing. */}
                {r.isActive && (
                  <button
                    onClick={() => clearRate(r)}
                    disabled={busy === r.id}
                    title="Stop applying this price. Nothing will be deleted."
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3] disabled:opacity-40">
                    {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />} Clear
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const INPUT = 'min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm text-sorena-navy focus:border-[#1e3a5f] focus:outline-none';
