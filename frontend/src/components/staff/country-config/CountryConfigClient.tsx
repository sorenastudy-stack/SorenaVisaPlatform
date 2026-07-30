'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, Save, Sliders, Bot, Plus, Trash2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-OWNER-1 (slice a) — Owner-editable per-country config UI.
//
// Three sections for the selected country: Execution (slot count / per-slot rules
// / institution-type weighting), AI config (guidance level / SOP gate), and AI
// agents (per-agent enable + max options). OWNER edits; SUPER_ADMIN sees a
// read-only view. The backend enforces OWNER on every PATCH regardless.

const INSTITUTION_TYPES = ['UNIVERSITY', 'ITP', 'PTE'] as const;
type InstitutionType = (typeof INSTITUTION_TYPES)[number];
// Friendly labels — the enum is UNIVERSITY/ITP/PTE; the PRD vocabulary is
// University/Polytechnic/College (ITP=Polytechnic, PTE=College per Phase 34).
const TYPE_LABEL: Record<InstitutionType, string> = {
  UNIVERSITY: 'University',
  ITP: 'Polytechnic (ITP)',
  PTE: 'College (PTE)',
};
const GUIDANCE_LEVELS = ['STRICT', 'MODERATE', 'LOW'] as const;
const AGENT_LABEL: Record<string, string> = {
  USER_GUIDANCE: 'User Guidance',
  COUNTRY_COMPARE: 'Country Compare',
  QUALIFICATION_SUPPORT: 'Qualification Support',
  RECOMMENDATION_EXPLAIN: 'Recommendation Explain',
  CASE_ASSISTANT: 'Case Assistant',
  SOP_GENERATION: 'SOP Generation',
  CV_GENERATION: 'CV Generation',
  AI_COMPANION: 'AI Companion',
  AUTOMATION_TRIGGER: 'Automation Trigger',
};

interface SlotRule { position: number; allowedTypes: string[]; mandatory?: boolean; preferred?: string }
interface ExecutionConfig { id: string; countryCode: string; slotCount: number; slotRules: SlotRule[]; institutionTypeWeighting: Record<string, number>; updatedAt: string }
interface AgentConfig { id: string; agentType: string; enabled: boolean; maxOptionsShown: number | null }
interface AIConfig { id: string; countryCode: string; guidanceLevel: string; sopGateEnforcement: boolean; agents: AgentConfig[] }
interface CountryDetail { countryCode: string; execution: ExecutionConfig | null; ai: AIConfig | null }
interface CountrySummary { countryCode: string; slotCount: number | null; guidanceLevel: string | null; agentCount: number }

export function CountryConfigClient({ viewerRole }: { viewerRole: string }) {
  const isOwner = viewerRole === 'OWNER';
  const [countries, setCountries] = useState<CountrySummary[] | null>(null);
  const [selected, setSelected] = useState<string>('NZ');
  const [detail, setDetail] = useState<CountryDetail | null>(null);
  const [error, setError] = useState(false);

  // Local drafts (edited copies); saved on demand per section.
  const [exec, setExec] = useState<ExecutionConfig | null>(null);
  const [ai, setAi] = useState<AIConfig | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.get<CountrySummary[]>('/staff/settings/country-config')
      .then((list) => {
        setCountries(list);
        if (list.length && !list.some((c) => c.countryCode === selected)) setSelected(list[0].countryCode);
      })
      .catch(() => setError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    setDetail(null); setExec(null); setAi(null); setError(false);
    api.get<CountryDetail>(`/staff/settings/country-config/${selected}`)
      .then((d) => {
        setDetail(d);
        setExec(d.execution ? structuredClone(d.execution) : null);
        setAi(d.ai ? structuredClone(d.ai) : null);
      })
      .catch(() => setError(true));
  }, [selected]);

  const weightSum = useMemo(
    () => (exec ? Object.values(exec.institutionTypeWeighting).reduce((a, b) => a + (Number(b) || 0), 0) : 0),
    [exec],
  );

  if (error) return <Shell><p className="text-red-600">Couldn’t load country config.</p></Shell>;
  if (!countries || !detail) return <Shell><Loader2 className="animate-spin text-gray-400" /></Shell>;

  // ── Save handlers ──────────────────────────────────────────────────────────
  const saveExecution = async () => {
    if (!exec) return;
    if (Math.abs(weightSum - 1) > 0.001) { toast.error(`Weighting must sum to 1.00 (currently ${weightSum.toFixed(2)}).`); return; }
    setSaving('exec');
    try {
      await api.patch(`/staff/settings/country-config/${selected}/execution`, {
        slotCount: exec.slotCount,
        slotRules: exec.slotRules,
        institutionTypeWeighting: exec.institutionTypeWeighting,
      });
      toast.success(`Execution config saved for ${selected}.`);
    } catch (e: any) { toast.error(e?.message ?? 'Save failed.'); }
    finally { setSaving(null); }
  };

  const saveAI = async () => {
    if (!ai) return;
    setSaving('ai');
    try {
      await api.patch(`/staff/settings/country-config/${selected}/ai`, {
        guidanceLevel: ai.guidanceLevel,
        sopGateEnforcement: ai.sopGateEnforcement,
      });
      toast.success(`AI config saved for ${selected}.`);
    } catch (e: any) { toast.error(e?.message ?? 'Save failed.'); }
    finally { setSaving(null); }
  };

  const saveAgent = async (agent: AgentConfig) => {
    setSaving(`agent:${agent.agentType}`);
    try {
      await api.patch(`/staff/settings/country-config/${selected}/ai/agents/${agent.agentType}`, {
        enabled: agent.enabled,
        maxOptionsShown: agent.maxOptionsShown,
      });
      toast.success(`${AGENT_LABEL[agent.agentType] ?? agent.agentType} saved.`);
    } catch (e: any) { toast.error(e?.message ?? 'Save failed.'); }
    finally { setSaving(null); }
  };

  // ── Slot-rule editing ────────────────────────────────────────────────────
  const setSlotRules = (rules: SlotRule[]) => setExec((p) => (p ? { ...p, slotRules: rules } : p));
  const toggleAllowed = (i: number, t: InstitutionType) => {
    if (!exec) return;
    const rules = structuredClone(exec.slotRules);
    const set = new Set(rules[i].allowedTypes);
    set.has(t) ? set.delete(t) : set.add(t);
    rules[i].allowedTypes = [...set];
    setSlotRules(rules);
  };
  const addSlot = () => exec && setSlotRules([...exec.slotRules, { position: exec.slotRules.length + 1, allowedTypes: ['UNIVERSITY'], mandatory: false }]);
  const removeSlot = (i: number) => exec && setSlotRules(exec.slotRules.filter((_, idx) => idx !== i).map((r, idx) => ({ ...r, position: idx + 1 })));

  const disabled = !isOwner;

  return (
    <Shell>
      {/* Country picker + read-only notice */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm font-medium text-[#1e3a5f]">
          <Globe size={16} /> Country
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          >
            {countries.map((c) => <option key={c.countryCode} value={c.countryCode}>{c.countryCode}</option>)}
          </select>
        </label>
        {!isOwner && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs text-amber-800">
            <Info size={13} /> Read-only — only the Owner can edit this config.
          </span>
        )}
      </div>

      {/* ── Execution config ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2 text-[#1e3a5f] font-semibold"><Sliders size={18} /> Institution distribution</div>

          {exec ? (
            <>
              {/* Slot count */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-40">Total priority slots</label>
                <input type="number" min={1} max={20} value={exec.slotCount} disabled={disabled}
                  onChange={(e) => setExec({ ...exec, slotCount: Number(e.target.value) })}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50" />
                <span className="text-xs text-gray-500">Total options offered to a student over the whole journey.</span>
              </div>

              {/* Weighting */}
              <div>
                <div className="text-sm text-gray-700 mb-2">Default sort weighting <span className="text-xs text-gray-500">(higher = ranked earlier; must sum to 1.00)</span></div>
                <div className="flex gap-4 flex-wrap">
                  {INSTITUTION_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <span className="w-32 text-gray-600">{TYPE_LABEL[t]}</span>
                      <input type="number" step={0.05} min={0} max={1} disabled={disabled}
                        value={exec.institutionTypeWeighting[t] ?? 0}
                        onChange={(e) => setExec({ ...exec, institutionTypeWeighting: { ...exec.institutionTypeWeighting, [t]: Number(e.target.value) } })}
                        className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50" />
                    </label>
                  ))}
                  <span className={['text-sm self-center', Math.abs(weightSum - 1) > 0.001 ? 'text-red-600' : 'text-green-700'].join(' ')}>
                    Σ {weightSum.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Slot rules */}
              <div>
                <div className="text-sm text-gray-700 mb-2">Per-slot rules <span className="text-xs text-gray-500">(allowed institution types + mandatory flag per position)</span></div>
                <div className="space-y-2">
                  {exec.slotRules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-3 flex-wrap rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                      <span className="text-xs font-semibold text-[#1e3a5f] w-14">Slot {rule.position}</span>
                      <div className="flex gap-3">
                        {INSTITUTION_TYPES.map((t) => (
                          <label key={t} className="flex items-center gap-1 text-xs text-gray-600">
                            <input type="checkbox" disabled={disabled} checked={rule.allowedTypes.includes(t)} onChange={() => toggleAllowed(i, t)} />
                            {TYPE_LABEL[t]}
                          </label>
                        ))}
                      </div>
                      <label className="flex items-center gap-1 text-xs text-gray-600 ml-2">
                        <input type="checkbox" disabled={disabled} checked={!!rule.mandatory}
                          onChange={(e) => { const r = structuredClone(exec.slotRules); r[i].mandatory = e.target.checked; setSlotRules(r); }} />
                        Mandatory
                      </label>
                      {!disabled && (
                        <button onClick={() => removeSlot(i)} className="ml-auto text-gray-400 hover:text-red-600" title="Remove slot"><Trash2 size={15} /></button>
                      )}
                    </div>
                  ))}
                </div>
                {!disabled && (
                  <button onClick={addSlot} className="mt-2 inline-flex items-center gap-1 text-sm text-[#1e3a5f] hover:underline"><Plus size={15} /> Add slot</button>
                )}
              </div>

              {!disabled && (
                <button onClick={saveExecution} disabled={saving === 'exec'}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving === 'exec' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save execution config
                </button>
              )}
            </>
          ) : <p className="text-sm text-gray-500">No execution config for {selected}. Seed it first.</p>}
        </CardContent>
      </Card>

      {/* ── AI config + agents ───────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2 text-[#1e3a5f] font-semibold"><Bot size={18} /> AI Agent Management</div>

          {ai ? (
            <>
              <div className="flex items-center gap-6 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  Guidance level
                  <select value={ai.guidanceLevel} disabled={disabled}
                    onChange={(e) => setAi({ ...ai, guidanceLevel: e.target.value })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:bg-gray-50">
                    {GUIDANCE_LEVELS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" disabled={disabled} checked={ai.sopGateEnforcement}
                    onChange={(e) => setAi({ ...ai, sopGateEnforcement: e.target.checked })} />
                  Enforce SOP quality gates
                </label>
                {!disabled && (
                  <button onClick={saveAI} disabled={saving === 'ai'}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {saving === 'ai' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save AI config
                  </button>
                )}
              </div>

              {/* Agents table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
                      <th className="py-2 pr-4">Agent</th>
                      <th className="py-2 pr-4">Enabled</th>
                      <th className="py-2 pr-4">Max options shown</th>
                      {!disabled && <th className="py-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ai.agents.map((agent, i) => (
                      <tr key={agent.agentType} className="border-b border-gray-100">
                        <td className="py-2 pr-4 text-gray-800">{AGENT_LABEL[agent.agentType] ?? agent.agentType}</td>
                        <td className="py-2 pr-4">
                          <input type="checkbox" disabled={disabled} checked={agent.enabled}
                            onChange={(e) => { const a = structuredClone(ai); a.agents[i].enabled = e.target.checked; setAi(a); }} />
                        </td>
                        <td className="py-2 pr-4">
                          <input type="number" min={0} max={50} disabled={disabled}
                            value={agent.maxOptionsShown ?? ''} placeholder="—"
                            onChange={(e) => { const a = structuredClone(ai); a.agents[i].maxOptionsShown = e.target.value === '' ? null : Number(e.target.value); setAi(a); }}
                            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50" />
                        </td>
                        {!disabled && (
                          <td className="py-2">
                            <button onClick={() => saveAgent(agent)} disabled={saving === `agent:${agent.agentType}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f] px-3 py-1 text-xs font-medium text-[#1e3a5f] hover:bg-[#1e3a5f]/5 disabled:opacity-60">
                              {saving === `agent:${agent.agentType}` ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-gray-500">“Max options shown” is how many options an agent surfaces in one interaction — only meaningful for surfacing agents (e.g. Recommendation Explain). Distinct from the total priority slots above.</p>
              </div>
            </>
          ) : <p className="text-sm text-gray-500">No AI config for {selected}. Seed it first.</p>}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#1e3a5f]">Country Config</h1>
        <p className="text-sm text-gray-500">Owner-level institution distribution & AI agent settings, per country. Changes apply without a deploy.</p>
      </div>
      {children}
    </div>
  );
}
