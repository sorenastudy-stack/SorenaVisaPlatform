'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Settings, ExternalLink, Copy, Check, RefreshCcw, AlertTriangle, Pencil, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-4 — OWNER-editable platform settings.
//
// Two sections:
//   1. Booking URLs (3 rows, edit-in-modal)
//   2. Wix integration (webhook secret + endpoint URL)
//
// Role gate happens at /staff/layout.tsx (StaffLayout). The backend
// independently enforces OWNER/SUPER_ADMIN on every route — defence
// in depth.

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
    title: 'Gap-Closing Roadmap Session (NZD 30)',
    subtitle: 'Band 3, no hard stop — paid Wix booking.',
  },
  BOOKING_URL_LIA_CONSULTATION: {
    title: 'LIA Consultation (NZD 150)',
    subtitle: 'Any band with hard stop — paid Wix booking.',
  },
};

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformSetting | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const webhookEndpoint = (() => {
    const base =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:3001';
    return `${base}/webhooks/wix/payment`;
  })();

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

  function copyToClipboard(text: string, key: string) {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  const bookingSettings = settings.filter((s) => BOOKING_KEYS.includes(s.key as any));
  const secretSetting = settings.find((s) => s.key === 'WIX_WEBHOOK_SECRET');

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Settings size={22} className="text-[#E8B923]" />
          Platform settings
        </h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">
          OWNER-editable configuration: scorecard booking URLs and the Wix Automation webhook secret.
          See the{' '}
          <Link href="/staff/platform-settings/wix-setup" className="text-[#1E3A5F] underline font-medium">
            Wix setup guide
          </Link>{' '}
          for how to connect Wix.
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
                    <div className="font-semibold text-[#1E3A5F] mb-1">{meta.title}</div>
                    <p className="text-xs text-[#4A4A4A]/70">{meta.subtitle}</p>
                    <p className="text-xs text-amber-700 mt-2 italic">Not yet seeded.</p>
                  </li>
                );
              }
              return (
                <li key={key} className="rounded-xl border border-gray-200 p-4 hover:border-[#E8B923]/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#1E3A5F] mb-1">{meta.title}</div>
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
                          className="inline-flex items-center gap-1 text-[#1E3A5F] hover:text-[#E8B923] font-medium"
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

      {/* ─── Wix integration ──────────────────────────────────── */}
      <Card>
        <CardContent>
          <h2 className="text-lg font-bold text-[#1E3A5F] mb-1">Wix integration</h2>
          <p className="text-sm text-[#4A4A4A]/70 mb-4">
            Wix Automations posts a webhook to this endpoint whenever a payment or booking completes.
            The header value below must match the secret in your Wix Automation configuration.
          </p>

          <div className="space-y-4">
            {/* Webhook endpoint */}
            <div>
              <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/70 font-semibold mb-1.5">
                Webhook endpoint URL
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 text-sm font-mono text-[#1E3A5F] bg-gray-50 rounded px-3 py-2 break-all">
                  {webhookEndpoint}
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookEndpoint, 'endpoint')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1E3A5F] text-[#1E3A5F] text-sm font-medium hover:bg-[#1E3A5F]/5"
                >
                  {copiedKey === 'endpoint'
                    ? <><Check size={13} /> Copied</>
                    : <><Copy size={13} /> Copy</>}
                </button>
              </div>
            </div>

            {/* Shared secret */}
            <div>
              <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/70 font-semibold mb-1.5">
                X-Sorena-Webhook-Secret header value
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 text-sm font-mono text-[#1E3A5F] bg-gray-50 rounded px-3 py-2 break-all">
                  {secretSetting?.value ?? '●●●●●●●● (not set)'}
                </div>
                <button
                  type="button"
                  onClick={() => setRegenOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#E8B923] text-[#1E3A5F] text-sm font-bold hover:bg-[#d4a91f]"
                >
                  <RefreshCcw size={13} /> Regenerate
                </button>
              </div>
              {secretSetting && (
                <p className="text-xs text-[#4A4A4A]/60 mt-1.5">
                  Last rotated {new Date(secretSetting.updatedAt).toLocaleString('en-NZ')}
                  {secretSetting.updatedByName ? ` · by ${secretSetting.updatedByName}` : ''}.
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100 text-sm">
            <Link
              href="/staff/platform-settings/wix-setup"
              className="inline-flex items-center gap-1 text-[#1E3A5F] hover:text-[#E8B923] font-medium"
            >
              How to connect Wix Automations → <ExternalLink size={12} />
            </Link>
          </div>
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

      {regenOpen && !newSecret && (
        <ConfirmRegenerateModal
          onCancel={() => setRegenOpen(false)}
          onConfirm={async () => {
            try {
              const res = await api.post<{
                key: string;
                plaintextValue: string;
                updatedAt: string;
              }>('/staff/platform-settings/wix-webhook-secret/regenerate', {});
              setNewSecret(res.plaintextValue);
              await load();
            } catch (e: any) {
              setError(e?.message ?? 'Failed to regenerate secret');
              setRegenOpen(false);
            }
          }}
        />
      )}

      {newSecret && (
        <NewSecretModal
          secret={newSecret}
          onClose={() => {
            setNewSecret(null);
            setRegenOpen(false);
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#E8B923] focus:ring-1 focus:ring-[#E8B923]"
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

// ─── ConfirmRegenerateModal ──────────────────────────────────

function ConfirmRegenerateModal({
  onCancel, onConfirm,
}: { onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={22} className="text-amber-600" />
          <h3 className="text-lg font-bold text-[#1E3A5F]">Regenerate webhook secret?</h3>
        </div>
        <p className="text-sm text-[#4A4A4A] leading-relaxed mb-2">
          This will invalidate the current secret. You&apos;ll need to update the Wix Automation
          header before the next payment, or webhook calls will be rejected.
        </p>
        <p className="text-sm text-[#4A4A4A] leading-relaxed">
          The new secret is shown once on this screen — copy it immediately. After this dialog
          closes the secret is masked forever.
        </p>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-[#1E3A5F] text-sm font-medium hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              await onConfirm();
            }}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Regenerating…' : 'Confirm regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NewSecretModal ──────────────────────────────────────────

function NewSecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <h3 className="text-lg font-bold text-[#1E3A5F] mb-2">New webhook secret</h3>
        <p className="text-sm text-[#4A4A4A] leading-relaxed mb-4">
          Copy this to your Wix Automation now. It will not be shown again.
        </p>

        <div className="bg-gray-50 rounded-lg p-3 font-mono text-sm text-[#1E3A5F] break-all border border-gray-200">
          {secret}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E8B923] text-[#1E3A5F] text-sm font-bold hover:bg-[#d4a91f]"
          >
            {copied
              ? <><Check size={13} /> Copied</>
              : <><Copy size={13} /> Copy to clipboard</>}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
