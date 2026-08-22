export type AttributionValues = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  firstTouchSource: string | null;
  lastTouchSource: string | null;
};

export type AttributionTouch = {
  occurredAt: Date;
  channel: 'SCORECARD' | 'WEBSITE_WEBINAR';
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export function planAttributionBackfill(
  current: AttributionValues,
  touches: AttributionTouch[],
): Partial<AttributionValues> {
  const ordered = [...touches].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (ordered.length === 0) return {};

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstCampaign = ordered.find((t) => t.utmSource || t.utmMedium || t.utmCampaign);
  const proposal: Partial<AttributionValues> = {};

  // Existing non-null values are authoritative and are never overwritten.
  if (!current.utmSource && firstCampaign?.utmSource) proposal.utmSource = firstCampaign.utmSource;
  if (!current.utmMedium && firstCampaign?.utmMedium) proposal.utmMedium = firstCampaign.utmMedium;
  if (!current.utmCampaign && firstCampaign?.utmCampaign) proposal.utmCampaign = firstCampaign.utmCampaign;
  if (!current.firstTouchSource) proposal.firstTouchSource = first.utmSource ?? first.channel;
  if (!current.lastTouchSource) proposal.lastTouchSource = last.utmSource ?? last.channel;
  return proposal;
}
