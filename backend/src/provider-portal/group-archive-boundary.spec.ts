import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL — archiving a country group, as source properties.
//
// The risk here is quiet: an archived group that is still offered somewhere, or
// an archive that takes prices down with it. Neither would throw; both would
// change what a student is quoted.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');
const group = read('./nationality-group.service.ts');
const progPricing = read('./provider-programme-pricing.service.ts');

describe('“delete” archives — it never removes a group or its prices', () => {
  it('there is no hard delete of a group anywhere', () => {
    expect(group).not.toMatch(/nationalityGroup\.delete\(/);
    expect(group).not.toMatch(/nationalityGroup\.deleteMany\(/);
  });

  it('archiving stamps a time rather than flipping a flag', () => {
    expect(group).toMatch(/data: \{ archivedAt \}/);
  });

  it('it does not touch a single priced row', () => {
    const body = group.slice(group.indexOf('async remove('), group.indexOf('// ── Rates attached to a group'));
    // Counting rows is allowed; writing to them is not.
    expect(body).not.toMatch(/providerTuition\.update|providerScholarship\.update/);
    expect(body).not.toMatch(/providerTuition\.delete|providerScholarship\.delete/);
    expect(body).not.toMatch(/isActive: false/);
  });

  it('is blocked while any rate is still LIVE — and only live ones count', () => {
    const body = group.slice(group.indexOf('async remove('), group.indexOf('// ── Rates attached to a group'));
    // BOTH counts, not just one. Scoping the tuition count and leaving the
    // scholarship count unscoped would still block a group whose scholarship had
    // merely been cleared — the exact bug being fixed, half-reintroduced.
    expect((body.match(/where: \{ nationalityGroupId: id, isActive: true \}/g) ?? []).length).toBe(2);
    expect(body).toMatch(/throw new ConflictException/);
    // The old rule counted every row that had ever referenced the group, which
    // is what made a once-priced group permanently undeletable.
    expect(body).not.toMatch(/_count: \{ select: \{ tuitions: true, scholarships: true \} \}/);
  });

  it('the refusal says what to do, and promises nothing is deleted', () => {
    expect(group).toMatch(/Clear those prices first, then archive the group/);
    expect(group).toMatch(/nothing will be deleted/);
  });

  it('the archive is audited with what was retained', () => {
    expect(group).toMatch(/PROVIDER_NATIONALITY_GROUP_ARCHIVED/);
    expect(group).toMatch(/retainedPricingRows/);
  });
});

describe('an archived group is off the menu everywhere a group can be chosen', () => {
  it('the group list shows active groups only', () => {
    expect(group).toMatch(/where: \{ providerId: actor\.providerId, \.\.\.ACTIVE_ONLY \}/);
    expect(group).toMatch(/const ACTIVE_ONLY = \{ archivedAt: null \}/);
  });

  it('a rate cannot be attached to an archived group', () => {
    // assertOwnedTargets resolves through selectable(), which adds archivedAt:null.
    const body = group.slice(group.indexOf('private async assertOwnedTargets'));
    expect(body).toMatch(/this\.selectable\(dto\.nationalityGroupId, actor\.providerId\)/);
  });

  it('selectable() means scoped AND not archived', () => {
    expect(group).toMatch(/private selectable\(id: string, providerId: string\) \{\s*\n\s*return \{ id, providerId, \.\.\.ACTIVE_ONLY \};/);
  });

  it('an archived group cannot be edited back into use', () => {
    const body = group.slice(group.indexOf('async update('), group.indexOf('async remove('));
    expect(body).toMatch(/this\.selectable\(id, actor\.providerId\)/);
  });

  it('the current-pricing view does not head a rate with an archived group', () => {
    // Otherwise the page contradicts itself: the group is gone from the list
    // above while its name still labels a rate below.
    const decl = group.match(/const notArchived = .*/)?.[0] ?? '';
    expect(decl).toContain('nationalityGroup: { archivedAt: null }');
    expect(decl).toContain('nationalityGroupId: null'); // ungrouped rates still show
    // Applied to BOTH queries — tuition and scholarship.
    expect((group.match(/\.\.\.notArchived/g) ?? []).length).toBe(2);
  });

  it('the per-programme screen neither offers nor writes an archived group', () => {
    const offers = progPricing.match(/where: \{ providerId: actor\.providerId, archivedAt: null \}/g) ?? [];
    // Once for the form's list, once for the write path — the write path matters
    // most: excluding archived groups there is what stops the reconcile loop
    // walking them and deactivating rates they still hold.
    expect(offers.length).toBe(2);
  });
});

describe('a retired name can be used again', () => {
  it('only an ACTIVE namesake is a clash', () => {
    expect(group).toMatch(/if \(clash\?\.archivedAt\) \{/);
    expect(group).toMatch(/\(archived \$\{clash\.archivedAt\.toISOString\(\)\.slice\(0, 10\)\}\)/);
  });

  it('the rename happens instead of a refusal, not as well as one', () => {
    const body = group.slice(group.indexOf('const clash = await'), group.indexOf('const group = await this.prisma.nationalityGroup.create'));
    expect(body).toMatch(/\} else if \(clash\) \{[\s\S]*ConflictException/);
  });
});
