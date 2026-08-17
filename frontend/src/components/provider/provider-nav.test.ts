/**
 * PR-PROVIDER-PORTAL — the portal's navigation, and where each upload lives.
 *
 * Asserted as source properties because these are placement decisions: a moved
 * tab that silently lands in two places, or a hidden feature that got deleted
 * rather than hidden, both look fine at a glance.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const at = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const shell = at('ProviderShell.tsx');
const home = at('ProviderHome.tsx');
const programmes = at('ProviderProgrammes.tsx');
const pricing = at('ProviderPricingGroups.tsx');

describe('Performance is hidden, not removed', () => {
  const nav = shell.slice(shell.indexOf('const NAV = ['), shell.indexOf('export function ProviderShell'));

  it('is absent from the nav list', () => {
    expect(/^\s*\{ href: '\/provider\/analytics'/m.test(nav)).toBe(false);
  });

  it('is left behind as a commented line, so restoring it is one edit', () => {
    expect(nav).toMatch(/\/\/ \{ href: '\/provider\/analytics', label: 'Performance'/);
  });

  it('the other three destinations are still listed', () => {
    for (const href of ['/provider', '/provider/programmes', '/provider/pricing']) {
      expect(nav).toMatch(new RegExp(`href: '${href}'`));
    }
  });
});

describe('each upload sits with the thing it acts on', () => {
  it('“Your institution” no longer uploads spreadsheets', () => {
    expect(home).not.toMatch(/ProviderImportSection/);
  });

  it('  and offers marketing materials instead', () => {
    expect(home).toMatch(/<ProviderMarketingAssets \/>/);
  });

  it('Programmes carries the programme sheet, and only that one', () => {
    expect(programmes).toMatch(/<ProviderImportSection kinds=\{\['programmes'\]\} \/>/);
    expect(programmes).not.toMatch(/kinds=\{\['tuition'/);
  });

  it('Country groups carries the money sheets, and not the programme one', () => {
    expect(pricing).toMatch(/<ProviderImportSection kinds=\{\['tuition', 'scholarships'\]\} \/>/);
    expect(pricing).not.toMatch(/'programmes'\]\}/);
  });

  it('no sheet type is offered in two places at once', () => {
    // The union of the two placements must cover each kind exactly once —
    // otherwise a provider meets the same upload twice and cannot tell which
    // one they used.
    const used = [...programmes.matchAll(/kinds=\{\[([^\]]*)\]\}/g), ...pricing.matchAll(/kinds=\{\[([^\]]*)\]\}/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    expect(used.sort()).toEqual(['programmes', 'scholarships', 'tuition']);
  });
});

describe('the import component can be scoped without changing what it does', () => {
  const imp = at('ProviderImportSection.tsx');

  it('takes a kinds prop, defaulting to all three', () => {
    expect(imp).toMatch(/kinds = \['tuition', 'scholarships', 'programmes'\] as Kind\[\]/);
  });

  it('still posts to the same endpoints', () => {
    expect(imp).toMatch(/\/provider\/imports\/\$\{copy\.path\}\/\$\{step\}/);
  });

  it('still states the review gate before the upload', () => {
    expect(imp).toMatch(/Everything you upload is checked by our team first/);
  });
});
