import { describe, expect, it } from 'vitest';
import {
  attributionFromLocation,
  captureFirstScorecardAttribution,
  readScorecardAttribution,
  SCORECARD_ATTRIBUTION_KEY,
} from './attribution';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value,
  };
}

describe('Scorecard campaign attribution', () => {
  it('maps standard UTM parameters to the platform DTO shape', () => {
    expect(attributionFromLocation(
      '?utm_source=google&utm_medium=cpc&utm_campaign=nz-2026&landing_page=%2Fknowledge-hub%2Fguide',
    )).toEqual({
      agentId: undefined,
      campaignLabel: undefined,
      channel: undefined,
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'nz-2026',
      landingPage: '/knowledge-hub/guide',
    });
  });

  it('stores only the referrer pathname, excluding query strings and fragments', () => {
    const result = attributionFromLocation(
      '?utm_source=meta',
      'https://sorenavisa.com/landing-pages/iran?email=private@example.com#form',
    );
    expect(result.landingPage).toBe('/landing-pages/iran');
  });

  it('preserves the first valid attribution bundle for the session', () => {
    const storage = memoryStorage();
    captureFirstScorecardAttribution(storage, '?utm_source=google&utm_campaign=first');
    const second = captureFirstScorecardAttribution(
      storage,
      '?utm_source=meta&utm_campaign=second',
    );
    expect(second.utmSource).toBe('google');
    expect(second.utmCampaign).toBe('first');
  });

  it('recovers from malformed stored JSON instead of blocking attribution', () => {
    const storage = memoryStorage('{not-json');
    const result = captureFirstScorecardAttribution(storage, '?utm_source=google');
    expect(result.utmSource).toBe('google');
    expect(JSON.parse(storage.value() ?? '{}').utmSource).toBe('google');
  });

  it('sanitises stored values when they are read back', () => {
    const storage = memoryStorage(JSON.stringify({
      utmSource: '  google  ',
      landingPage: 'https://sorenavisa.com/contact?token=secret',
    }));
    expect(readScorecardAttribution(storage)).toMatchObject({
      utmSource: 'google',
      landingPage: '/contact',
    });
    expect(SCORECARD_ATTRIBUTION_KEY).toBe('sv_scorecard_attribution');
  });
});
