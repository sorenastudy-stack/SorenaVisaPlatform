'use client';

// PR-CONSULT-3 — Payload preview for CHANGE_PLATFORM_SETTING.
//
// Payload shape from execChangePlatformSetting:
//   { key, value }
//
// `value` is encrypted at rest server-side but the API decrypts
// before returning. We still truncate at 100 chars for the
// preview — full value is available via the OWNER's audit log.
export function ChangePlatformSettingPayload({ payload }: { payload: Record<string, unknown> }) {
  const key   = String(payload.key ?? '—');
  const value = String(payload.value ?? '');
  const truncated = value.length > 100 ? value.slice(0, 100) + '…' : value;
  return (
    <dl className="text-sm space-y-1">
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Key</dt>
        <dd className="text-gray-900 break-all text-right font-mono text-xs">{key}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Value</dt>
        <dd className="text-gray-900 break-all text-right font-mono text-xs">{truncated || '—'}</dd>
      </div>
    </dl>
  );
}
