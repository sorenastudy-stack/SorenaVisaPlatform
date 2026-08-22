import { planAttributionBackfill } from './utm-attribution-backfill';

const empty = {
  utmSource: null, utmMedium: null, utmCampaign: null,
  firstTouchSource: null, lastTouchSource: null,
};

describe('planAttributionBackfill', () => {
  it('uses earliest campaign and chronological first/last touches', () => {
    const result = planAttributionBackfill(empty, [
      { occurredAt: new Date('2026-02-02'), channel: 'SCORECARD', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'later' },
      { occurredAt: new Date('2026-01-01'), channel: 'WEBSITE_WEBINAR', utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'first' },
    ]);
    expect(result).toEqual({
      utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'first',
      firstTouchSource: 'meta', lastTouchSource: 'google',
    });
  });

  it('never overwrites existing non-null attribution', () => {
    const result = planAttributionBackfill({
      utmSource: 'existing', utmMedium: 'existing-medium', utmCampaign: 'existing-campaign',
      firstTouchSource: 'existing-first', lastTouchSource: 'existing-last',
    }, [{ occurredAt: new Date(), channel: 'SCORECARD', utmSource: 'new', utmMedium: 'new', utmCampaign: 'new' }]);
    expect(result).toEqual({});
  });

  it('uses channel fallbacks for direct traffic', () => {
    expect(planAttributionBackfill(empty, [
      { occurredAt: new Date(), channel: 'WEBSITE_WEBINAR', utmSource: null, utmMedium: null, utmCampaign: null },
    ])).toEqual({ firstTouchSource: 'WEBSITE_WEBINAR', lastTouchSource: 'WEBSITE_WEBINAR' });
  });
});
