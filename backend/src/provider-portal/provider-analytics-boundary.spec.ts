import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL slice F — the analytics boundary as source properties.
//
// A read-only panel is the easiest place to leak: one forgotten `where` and an
// institution is looking at a competitor's demand, with nothing failing.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');

describe('the analytics endpoint can only ever describe the caller', () => {
  const ctrl = read('./provider-analytics.controller.ts');
  const svc = read('./provider-analytics.service.ts');

  it('accepts no id in path, query or body', () => {
    expect(ctrl).not.toMatch(/@Param\(/);
    expect(ctrl).not.toMatch(/@Query\(/);
    expect(ctrl).not.toMatch(/@Body\(/);
    const routes = ctrl.match(/@Get\(([^)]*)\)/g) ?? [];
    expect(routes.length).toBe(1);
    expect(routes[0]).not.toContain(':');
  });

  it('is guarded by JwtAuthGuard, RolesGuard AND ProviderAccessGuard', () => {
    expect(ctrl).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard,\s*ProviderAccessGuard\)/);
    expect(ctrl).toMatch(/@Roles\('PROVIDER'\)/);
  });

  it('takes the institution only from the guard', () => {
    expect(ctrl).toMatch(/providerId: req\.providerAccess\.providerId/);
  });

  it('is read-only — no write verb anywhere on it', () => {
    for (const verb of ['@Post(', '@Patch(', '@Put(', '@Delete(']) {
      expect(ctrl.includes(verb)).toBe(false);
    }
  });

  it('every query is filtered by the caller', () => {
    const finds = svc.match(/findMany\(\{/g) ?? [];
    expect(finds.length).toBe(1);
    expect(svc).toMatch(/where: \{ providerId: actor\.providerId \}/);
  });

  it('counts via correlated _count rather than a query per programme', () => {
    // An N+1 here would still be correct, but it would be the version that stops
    // being cheap first — and the slice's whole premise is that it is cheap.
    expect(svc).toMatch(/_count: \{ select: \{ recommendationItems: true, admissionChoices: true \} \}/);
    expect(svc).not.toMatch(/recommendationItem\.count|admissionProgrammeChoice\.count/);
  });

  it('exposes nothing comparative — no other provider is ever read', () => {
    // The absence test. Totals here are the caller's own; a platform-wide count
    // or an average across institutions is a different product.
    //
    // Comments are stripped first: this is a claim about the CODE, and the prose
    // above it legitimately contains the words "compare" and "ranking" while
    // explaining their absence. (It caught itself on that first — a test that
    // fails because of a comment is a test measuring the wrong thing.)
    const code = svc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/educationProvider\./);
    expect(code).not.toMatch(/providerId: \{ not:/);
    expect(code).not.toMatch(/\brank\b|percentile|average|median|compare/i);
    // and the stripping really happened — otherwise this asserts nothing
    expect(code.length).toBeLessThan(svc.length);
    expect(code).toContain('findMany');
  });

  it('reports the review/active state so a zero can be read correctly', () => {
    expect(svc).toMatch(/isActive: p\.isActive/);
    expect(svc).toMatch(/reviewStatus: p\.reviewStatus/);
  });
});
