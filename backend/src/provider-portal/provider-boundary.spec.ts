import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL slice B — the boundary, asserted as SOURCE PROPERTIES.
//
// The behavioural cross-tenant proof runs against a live server with two real
// institutions. These are the checks that must hold even when nobody is looking:
// each one fails if a future edit quietly widens the boundary, which is exactly
// the change that would not look dangerous in review.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');

describe('ProvidersController must never admit the PROVIDER role', () => {
  // THE test the brief asked for. A wrapper that works proves nothing if the
  // staff controller also answers a provider — this asserts the ABSENCE, so
  // "helpfully" adding PROVIDER to a role list there fails the build.
  it('has no @Roles list containing PROVIDER', () => {
    const src = read('../providers/providers.controller.ts');
    const roleLists = src.match(/@Roles\([^)]*\)/g) ?? [];
    expect(roleLists.length).toBeGreaterThan(5);   // the file really was scanned
    const offenders = roleLists.filter((r) => /['"]PROVIDER['"]/.test(r));
    expect(offenders).toEqual([]);
  });

  it('does not use PROVIDER in its role constants', () => {
    const src = read('../providers/providers.controller.ts');
    // PROVIDER_ADMIN is a staff tier and legitimately contains the substring, so
    // match the quoted role value rather than the word.
    expect(/['"]PROVIDER['"]/.test(src)).toBe(false);
  });
});

describe('the provider controller cannot be told which institution to act on', () => {
  const src = read('./provider-portal.controller.ts');

  it('declares no route with a path parameter', () => {
    const routes = src.match(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g) ?? [];
    expect(routes.length).toBeGreaterThan(0);
    // A ':' inside a route path is a caller-supplied segment.
    expect(routes.filter((r) => r.includes(':'))).toEqual([]);
  });

  it('never reads an id from params, query or body', () => {
    expect(src).not.toMatch(/@Param\(/);
    expect(src).not.toMatch(/@Query\(/);
    expect(src).not.toMatch(/body\.(providerId|id)\b/);
  });

  it('takes the provider id only from the guard-resolved identity', () => {
    const uses = src.match(/req\.providerAccess\.providerId/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
  });

  it('is guarded by JwtAuthGuard, RolesGuard AND ProviderAccessGuard', () => {
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard,\s*ProviderAccessGuard\)/);
    expect(src).toMatch(/@Roles\('PROVIDER'\)/);
  });
});

describe('the provider DTO cannot carry commercial terms', () => {
  const dto = read('./dto/update-own-provider.dto.ts');
  const FORBIDDEN = [
    'commissionY1Type', 'commissionY1Value', 'commissionY2Type', 'commissionY2Value',
    'commissionEnglishY1Type', 'commissionEnglishY1Value',
    'commissionEnglishY2Type', 'commissionEnglishY2Value',
    'volumeTarget', 'bonusType', 'bonusValue',
    'status', 'isFeatured', 'rankingTier', 'rankingScore', 'userId', 'notes',
  ];

  it.each(FORBIDDEN)('does not declare %s as an editable field', (field) => {
    // The comment block names these deliberately, so match a property
    // DECLARATION rather than any mention.
    const declared = new RegExp(`^\\s*${field}\\??\\s*:`, 'm').test(dto);
    expect(declared).toBe(false);
  });

  it('declares exactly the six intended fields', () => {
    const declared = [...dto.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual(
      ['aboutUrl', 'catalogueUrl', 'city', 'descriptionEn', 'legalEntityName', 'websiteUrl'],
    );
  });
});

describe('the access helper resolves identity from the JWT alone', () => {
  const src = read('./provider-access.helper.ts');

  it('looks the provider up by userId and nothing else', () => {
    expect(src).toMatch(/findUnique\(\{\s*where:\s*\{\s*userId\s*\}/);
  });

  it('denies when there is no user id', () => {
    expect(src).toMatch(/if \(!userId\) return DENIED\('NO_PROVIDER_RECORD'\)/);
  });

  it('denies an institution that is not ACTIVE', () => {
    expect(src).toMatch(/status !== 'ACTIVE'/);
  });
});

describe('the provider read is an explicit select', () => {
  it('never returns the whole row', () => {
    const src = read('./provider-portal.service.ts');
    // A bare findUnique with no select would return commission terms, agreement
    // dates, internal ranking and staff notes.
    expect(src).toMatch(/select:\s*\{/);
    for (const leak of ['commissionY1Value', 'bonusValue', 'notes:', 'rankingScore']) {
      expect(src.includes(`${leak} true`)).toBe(false);
    }
  });
});
