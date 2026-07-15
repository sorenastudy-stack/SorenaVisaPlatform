'use client';

import { useEffect, useState } from 'react';
import {
  Settings, ExternalLink, Pencil, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-4 — OWNER-editable platform settings.
//
// Booking URLs (3 rows, edit-in-modal) that drive the scorecard result-page
// CTAs. Role gate happens at /staff/layout.tsx (StaffLayout); the backend
// independently enforces OWNER/SUPER_ADMIN on every route.

interface PlatformSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  category: string;
  updatedAt: string;
  createdAt: string;
  updatedById: string;
  updatedByName: string | null;
}

const BOOKING_KEYS = [
  'BOOKING_URL_FREE_15MIN',
  'BOOKING_URL_GAP_CLOSING',
  'BOOKING_URL_LIA_CONSULTATION',
] as const;

const BOOKING_LABELS: Record<string, { title: string; subtitle: string }> = {
  BOOKING_URL_FREE_15MIN: {
    title: 'Free 15-minute consultation',
    subtitle: 'Bands 4-6, no hard stop — primary CTA on the result page.',
  },
  BOOKING_URL_GAP_CLOSING: {
    title: 'Gap-Closing Roadmap Session',
    subtitle: 'Band 3, no hard stop — paid booking. Price is set in backend session-config.',
  },
  BOOKING_URL_LIA_CONSULTATION: {
    title: 'LIA Consultation',
    subtitle: 'Any band with hard stop — paid booking.',
  },
};

// Maps each booking-URL setting to its session-config type, so the title can
// show the LIVE price from GET /booking/session-types (single source — no
// hardcoded price literal on this page).
const KEY_TO_TYPE: Record<string, string> = {
  BOOKING_URL_FREE_15MIN:      'FREE_15',
  BOOKING_URL_GAP_CLOSING:     'GAP_CLOSING',
  BOOKING_URL_LIA_CONSULTATION: 'LIA',
};

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformSetting | null>(null);
  // Live session prices (single-sourced from backend session-config) for the
  // booking titles. Falls back to no price suffix if the fetch fails.
  const [prices, setPrices] = useState<Record<string, { price: number; currency: string }>>({});

  useEffect(() => {
    api
      .get<Array<{ type: string; price: number; currency: string }>>('/booking/session-types')
      .then((rows) => {
        const m: Record<string, { price: number; currency: string }> = {};
        rows.forEach((r) => { m[r.type] = { price: r.price, currency: r.currency }; });
        setPrices(m);
      })
      .catch(() => { /* titles fall back to base (no price) */ });
  }, []);

  const titleFor = (key: string, base: string): string => {
    const p = prices[KEY_TO_TYPE[key]];
    return p && p.price > 0 ? `${base} (${p.currency} ${p.price})` : base;
  };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PlatformSetting[]>('/staff/platform-settings');
      setSettings(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const bookingSettings = settings.filter((s) => BOOKING_KEYS.includes(s.key as any));

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Settings size={22} className="text-[#b8941f]" />
          Platform settings
        </h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">
          OWNER-editable configuration: the scorecard booking URLs.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* ─── Booking URLs ──────────────────────────────────────── */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-lg font-bold text-[#1E3A5F] mb-1">Booking URLs</h2>
          <p className="text-sm text-[#4A4A4A]/70 mb-4">
            Public scorecard result page sends users to these URLs. Edits take effect immediately
            (60-second server-side cache, then propagated to all browsers).
          </p>

          {loading && (
            <div className="text-sm text-[#4A4A4A]/60 py-4">Loading…</div>
          )}

          {!loading && bookingSettings.length === 0 && (
            <div className="text-sm text-[#4A4A4A]/60 py-4">
              No booking URLs configured yet. They&apos;ll be created when you first edit one.
            </div>
          )}

          <ul className="space-y-3">
            {BOOKING_KEYS.map((key) => {
              const s = bookingSettings.find((r) => r.key === key);
              const meta = BOOKING_LABELS[key];
              if (!s) {
                return (
                  <li key={key} className="rounded-xl border border-gray-200 p-4">
                    <div className="font-semibold text-[#1E3A5F] mb-1">{titleFor(key, meta.title)}</div>
                    <p className="text-xs text-[#4A4A4A]/70">{meta.subtitle}</p>
                    <p className="text-xs text-amber-700 mt-2 italic">Not yet seeded.</p>
                  </li>
                );
              }
              return (
                <li key={key} className="rounded-xl border border-gray-200 p-4 hover:border-[#F3CE49]/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#1E3A5F] mb-1">{titleFor(key, meta.title)}</div>
                      <p className="text-xs text-[#4A4A4A]/70 mb-2">{meta.subtitle}</p>
                      <div className="text-sm font-mono text-[#1E3A5F] bg-gray-50 rounded px-2 py-1.5 break-all">
                        {s.value}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-[#4A4A4A]/60">
                        <span>
                          Updated {new Date(s.updatedAt).toLocaleString('en-NZ')}
                          {s.updatedByName ? ` · by ${s.updatedByName}` : ''}
                        </span>
                        <a
                          href={s.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#1E3A5F] hover:text-[#b8941f] font-medium"
                        >
                          Open <ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#1E3A5F] text-sm font-medium hover:bg-[#1E3A5F]/5 flex-shrink-0"
                    >
                      <Pencil size={13} /> Edit
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {editing && (
        <EditUrlModal
          setting={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── EditUrlModal ─────────────────────────────────────────────

function EditUrlModal({
  setting, onClose, onSaved,
}: {
  setting: PlatformSetting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(setting.value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isUrl = /^https?:\/\/.+/i.test(value.trim());

  async function save() {
    setErr(null);
    if (!isUrl) {
      setErr('Must be a valid http:// or https:// URL.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/staff/platform-settings/${setting.key}`, { value: value.trim() });
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-[#1E3A5F]">Edit URL</h3>
            <p className="text-xs text-[#4A4A4A]/70 font-mono mt-1">{setting.key}</p>
          </div>
          <button onClick={onClose} className="text-[#4A4A4A]/60 hover:text-[#1E3A5F]">
            <X size={20} />
          </button>
        </div>

        <label className="block text-sm font-semibold text-[#1E3A5F] mb-1.5">
          URL
        </label>
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#F3CE49] focus:ring-1 focus:ring-[#F3CE49]"
          placeholder="https://..."
        />
        {!isUrl && value.length > 0 && (
          <p className="text-xs text-amber-700 mt-1">Must start with http:// or https://</p>
        )}
        {err && (
          <p className="text-xs text-red-700 mt-1">{err}</p>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-[#1E3A5F] text-sm font-medium hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !isUrl}
            className="px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
