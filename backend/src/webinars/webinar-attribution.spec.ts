import { webinarLeadAttribution } from './webinar-attribution';

describe('webinarLeadAttribution', () => {
  it('sets first and last touch for a new attributed Lead', () => {
    expect(webinarLeadAttribution(null, {
      utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'nz-august',
    })).toEqual({
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'nz-august',
      firstTouchSource: 'google',
      lastTouchSource: 'google',
    });
  });

  it('preserves the canonical first campaign and updates last touch', () => {
    expect(webinarLeadAttribution({
      sourceChannel: 'SCORECARD',
      utmSource: 'meta',
      utmMedium: 'paid-social',
      utmCampaign: 'first-campaign',
      firstTouchSource: 'meta',
    }, {
      utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'later-webinar',
    })).toEqual({
      utmSource: 'meta',
      utmMedium: 'paid-social',
      utmCampaign: 'first-campaign',
      firstTouchSource: 'meta',
      lastTouchSource: 'google',
    });
  });

  it('uses the webinar channel when no UTM source exists', () => {
    expect(webinarLeadAttribution(null, {
      utmSource: null, utmMedium: null, utmCampaign: null,
    })).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      firstTouchSource: 'WEBSITE_WEBINAR',
      lastTouchSource: 'WEBSITE_WEBINAR',
    });
  });
});
