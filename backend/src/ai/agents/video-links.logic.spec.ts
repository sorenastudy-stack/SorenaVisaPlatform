import {
  buildWatchUrl,
  linkAttributes,
  extractVideoId,
  isValidVideoId,
  resolveVideoCards,
} from './video-links.logic';

describe('buildWatchUrl — outbound only, never an embed', () => {
  it('builds the canonical watch URL', () => {
    expect(buildWatchUrl('bb4kZsIKdmE')).toBe('https://www.youtube.com/watch?v=bb4kZsIKdmE');
  });

  it('never produces an /embed/ URL', () => {
    expect(buildWatchUrl('bb4kZsIKdmE')).not.toContain('/embed/');
  });
});

describe('linkAttributes — fixed by product rule', () => {
  it('always opens a new tab with noopener noreferrer', () => {
    expect(linkAttributes()).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});

describe('isValidVideoId', () => {
  it('accepts a real 11-char id', () => {
    expect(isValidVideoId('rzo_pkEzAwY')).toBe(true);
  });

  it('rejects wrong lengths and bad characters', () => {
    expect(isValidVideoId('short')).toBe(false);
    expect(isValidVideoId('bb4kZsIKdmE!')).toBe(false);
    expect(isValidVideoId(null)).toBe(false);
  });
});

describe('extractVideoId — accept what staff actually paste', () => {
  it.each([
    ['bb4kZsIKdmE', 'bare id'],
    ['https://www.youtube.com/watch?v=bb4kZsIKdmE', 'watch URL'],
    ['https://youtu.be/bb4kZsIKdmE', 'short link'],
    ['https://www.youtube.com/shorts/bb4kZsIKdmE', 'shorts URL'],
    ['https://www.youtube.com/embed/bb4kZsIKdmE', 'embed URL'],
    ['https://m.youtube.com/watch?v=bb4kZsIKdmE&t=30s', 'mobile URL with timestamp'],
    ['youtube.com/watch?v=bb4kZsIKdmE', 'no scheme'],
  ])('extracts from %s (%s)', (input) => {
    expect(extractVideoId(input)).toBe('bb4kZsIKdmE');
  });

  it('returns null for junk rather than guessing', () => {
    expect(extractVideoId('not a link')).toBeNull();
    expect(extractVideoId('https://vimeo.com/12345')).toBeNull();
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId(null)).toBeNull();
  });
});

describe('resolveVideoCards — manual override precedence', () => {
  const ai = [
    { videoId: 'rzo_pkEzAwY', title: 'AI pick one', matchReason: 'field' },
    { videoId: 'Xs72sE9vxgI', title: 'AI pick two', matchReason: 'level' },
  ];

  it('uses AI matches when there is no manual override', () => {
    const cards = resolveVideoCards([], ai);
    expect(cards.map((c) => c.videoId)).toEqual(['rzo_pkEzAwY', 'Xs72sE9vxgI']);
    expect(cards.every((c) => c.source === 'AI_MATCHED')).toBe(true);
  });

  it('manual REPLACES the AI matches entirely — never merges', () => {
    const cards = resolveVideoCards(['bb4kZsIKdmE'], ai);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ videoId: 'bb4kZsIKdmE', source: 'MANUAL' });
    expect(cards.map((c) => c.videoId)).not.toContain('rzo_pkEzAwY');
  });

  it('accepts a pasted URL as the manual override', () => {
    const cards = resolveVideoCards(['https://youtu.be/bb4kZsIKdmE'], ai);
    expect(cards[0].watchUrl).toBe('https://www.youtube.com/watch?v=bb4kZsIKdmE');
  });

  it('falls back to AI when the manual value is unusable', () => {
    // NB: "not-a-video" would NOT work here — it is 11 chars of [A-Za-z0-9_-]
    // and therefore a syntactically valid video id. Use something that cannot be.
    const cards = resolveVideoCards(['https://vimeo.com/12345'], ai);
    expect(cards[0].source).toBe('AI_MATCHED');
  });

  it('every card carries the outbound-link attributes', () => {
    for (const c of resolveVideoCards([], ai)) {
      expect(c.target).toBe('_blank');
      expect(c.rel).toBe('noopener noreferrer');
      expect(c.watchUrl.startsWith('https://www.youtube.com/watch?v=')).toBe(true);
    }
  });

  it('dedupes and respects the limit', () => {
    const cards = resolveVideoCards([], [
      ...ai,
      { videoId: 'rzo_pkEzAwY', title: 'dup' },
      { videoId: '8bKw76kSuP4', title: 'third' },
      { videoId: 'gqw7PgCyrzY', title: 'fourth' },
    ]);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.videoId)).size).toBe(3);
  });

  it('returns an empty list when there is nothing — page degrades, never breaks', () => {
    expect(resolveVideoCards(null, null)).toEqual([]);
    expect(resolveVideoCards([], [])).toEqual([]);
  });
});
