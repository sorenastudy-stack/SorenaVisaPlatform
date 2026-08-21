export const SCORECARD_ATTRIBUTION_KEY = 'sv_scorecard_attribution';

export interface ScorecardAttribution {
  trackingLinkId?: string;
  agentId?: string;
  campaignLabel?: string;
  channel?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landingPage?: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const FIELD_LIMITS = {
  agentId: 191,
  campaignLabel: 255,
  channel: 64,
  utmSource: 255,
  utmMedium: 255,
  utmCampaign: 255,
} as const;

function clean(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

/**
 * Store only a pathname, never a full referrer/query string. Campaign URLs
 * can contain identifiers or search terms that do not belong in CRM records.
 */
function cleanLandingPage(value: unknown): string | undefined {
  const candidate = clean(value, 4096);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, 'https://sorenavisa.com');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return clean(url.pathname, 2048);
  } catch {
    return undefined;
  }
}

function fromUnknown(value: unknown): ScorecardAttribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    agentId: clean(record.agentId, FIELD_LIMITS.agentId),
    campaignLabel: clean(record.campaignLabel, FIELD_LIMITS.campaignLabel),
    channel: clean(record.channel, FIELD_LIMITS.channel),
    utmSource: clean(record.utmSource, FIELD_LIMITS.utmSource),
    utmMedium: clean(record.utmMedium, FIELD_LIMITS.utmMedium),
    utmCampaign: clean(record.utmCampaign, FIELD_LIMITS.utmCampaign),
    landingPage: cleanLandingPage(record.landingPage),
  };
}

function hasAttribution(value: ScorecardAttribution): boolean {
  return Object.values(value).some(Boolean);
}

export function readScorecardAttribution(storage: StorageLike): ScorecardAttribution {
  try {
    const raw = storage.getItem(SCORECARD_ATTRIBUTION_KEY);
    return raw ? fromUnknown(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function attributionFromLocation(
  search: string,
  referrer = '',
): ScorecardAttribution {
  const params = new URLSearchParams(search);
  return fromUnknown({
    channel: params.get('ch'),
    agentId: params.get('agent'),
    campaignLabel: params.get('campaign'),
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    landingPage: params.get('landing_page') || referrer,
  });
}

/** Preserve the first valid attribution bundle for the browser session. */
export function captureFirstScorecardAttribution(
  storage: StorageLike,
  search: string,
  referrer = '',
): ScorecardAttribution {
  const existing = readScorecardAttribution(storage);
  if (hasAttribution(existing)) return existing;

  const incoming = attributionFromLocation(search, referrer);
  if (!hasAttribution(incoming)) return {};

  try {
    storage.setItem(SCORECARD_ATTRIBUTION_KEY, JSON.stringify(incoming));
  } catch {
    // Attribution is optional; storage restrictions must not block the form.
  }
  return incoming;
}
