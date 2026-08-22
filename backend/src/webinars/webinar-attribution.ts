export interface WebinarLeadAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  firstTouchSource: string;
  lastTouchSource: string;
}

type ExistingLeadAttribution = {
  sourceChannel?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  firstTouchSource?: string | null;
};

/**
 * Preserve the canonical Lead's first attributable campaign and update only
 * its latest-touch marker. The webinar registration itself retains every
 * touch's complete UTM bundle and landing page.
 */
export function webinarLeadAttribution(
  existing: ExistingLeadAttribution | null,
  incoming: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null },
): WebinarLeadAttribution {
  const origin = existing?.utmSource ?? incoming.utmSource
    ?? existing?.sourceChannel ?? 'WEBSITE_WEBINAR';
  return {
    utmSource: existing?.utmSource ?? incoming.utmSource,
    utmMedium: existing?.utmMedium ?? incoming.utmMedium,
    utmCampaign: existing?.utmCampaign ?? incoming.utmCampaign,
    firstTouchSource: existing?.firstTouchSource ?? origin,
    lastTouchSource: incoming.utmSource ?? 'WEBSITE_WEBINAR',
  };
}
