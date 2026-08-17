import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL slice D — the programme boundary as source properties.
//
// This is the first portal controller that accepts an id, so the checks that
// matter are different from slices B and C: not "does it refuse ids" but "is
// every single lookup scoped by the owner as well". A `findUnique({ where: { id } })`
// added here later would look completely ordinary in review and would hand one
// institution another's catalogue.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');

describe('every programme lookup is scoped by owner, not by id alone', () => {
  const src = read('./provider-programme.service.ts');

  it('has no findUnique at all — only findFirst with a scope', () => {
    // findUnique CANNOT take a providerId (it is not part of any unique index),
    // so its presence in this file would mean an unscoped read by definition.
    expect(src).not.toMatch(/educationProgramme\.findUnique/);
  });

  it('every read passes through scoped()', () => {
    const reads = src.match(/educationProgramme\.findFirst\(\{\s*\n\s*where:\s*([^\n]*)/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(3); // getOne, update, setActive
    for (const r of reads) expect(r).toContain('this.scoped(');
  });

  it('scoped() requires BOTH the id and the provider', () => {
    expect(src).toMatch(/private scoped\(programmeId: string, providerId: string\) \{\s*\n\s*return \{ id: programmeId, providerId \};/);
  });

  it('the list is filtered to the caller', () => {
    expect(src).toMatch(/findMany\(\{\s*\n\s*where: \{ providerId: actor\.providerId \}/);
  });

  it('the two updates run only after a scoped read has proven ownership', () => {
    // Each `update({ where: { id: programmeId } })` must be preceded in its own
    // method by a scoped findFirst and a not-found throw.
    for (const method of ['async update(', 'async setActive(']) {
      const start = src.indexOf(method);
      const body = src.slice(start, src.indexOf('\n  }', start));
      expect(body).toContain('this.scoped(programmeId, actor.providerId)');
      expect(body).toMatch(/if \(!existing\) throw new NotFoundException/);
      expect(body.indexOf('this.scoped(')).toBeLessThan(body.indexOf('.update('));
    }
  });

  it('never selects staff-internal columns', () => {
    for (const leak of ['notes:', 'verificationStatus', 'aiPopulated', 'sourceRef: true']) {
      expect(src.includes(leak)).toBe(false);
    }
  });
});

describe('the provider programme controller', () => {
  const src = read('./provider-programme.controller.ts');

  it('is guarded by JwtAuthGuard, RolesGuard AND ProviderAccessGuard', () => {
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard,\s*ProviderAccessGuard\)/);
    expect(src).toMatch(/@Roles\('PROVIDER'\)/);
  });

  it('takes the institution only from the guard', () => {
    expect(src).toMatch(/providerId: req\.providerAccess\.providerId/);
    expect(src).not.toMatch(/body\.providerId|@Query\(/);
  });

  it('exposes NO delete route', () => {
    expect(src).not.toMatch(/@Delete\(/);
    expect(src).not.toMatch(/\bdelete\b\s*\(/);
  });

  it('keeps activation on its own route, out of the edit DTO', () => {
    expect(src).toMatch(/@Patch\(':id\/active'\)/);
    const dto = read('./dto/provider-programme.dto.ts');
    expect(new RegExp('^\\s*isActive\\??\\s*:', 'm').test(dto)).toBe(false);
  });

  it('rate-limits every write', () => {
    // Counted rather than fixed at a number: the invariant is "every write verb
    // carries a throttle", and pinning the count meant adding a route made this
    // fail for the wrong reason. PUT is included — group pricing uses it.
    const writes = (src.match(/@(Post|Patch|Put|Delete)\(/g) ?? []).length;
    const limits = (src.match(/@Throttle\(/g) ?? []).length;
    expect(writes).toBeGreaterThanOrEqual(4);
    expect(limits).toBe(writes);
  });
});

describe('per-programme group pricing stays inside the same boundary', () => {
  const ctrl = read('./provider-programme.controller.ts');
  const svc = read('./provider-programme-pricing.service.ts');

  it('the programme is verified as the caller’s before anything is written', () => {
    expect(svc).toMatch(/where: \{ id: programmeId, providerId: actor\.providerId \}/);
    const body = svc.slice(svc.indexOf('async set('));
    expect(body.indexOf('assertOwnProgramme')).toBeLessThan(body.indexOf('nationalityGroup.findMany'));
  });

  it('a group that is not the caller’s is refused, not skipped', () => {
    expect(svc).toMatch(/if \(!byId\.has\(e\.nationalityGroupId\)\) throw new NotFoundException/);
  });

  it('every pricing query is scoped by providerId', () => {
    const queries = svc.match(/where: \{ providerId: actor\.providerId[^}]*\}/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(4);
  });

  it('new pricing lands PENDING and a changed amount returns to PENDING', () => {
    expect(svc).toMatch(/reviewStatus: 'PENDING'/);
    expect((svc.match(/amountChanged \? \{ reviewStatus: 'PENDING' as const \} : \{\}/g) ?? []).length).toBe(2);
  });

  it('unchecking DEACTIVATES — it never deletes', () => {
    expect(svc).not.toMatch(/providerTuition\.delete|providerScholarship\.delete/);
    expect(svc).toMatch(/data: \{ isActive: false, updatedById: actor\.userId \}/);
  });

  it('reactivating an unchanged row does not cost its approval', () => {
    // `isActive: true` is set unconditionally on the update; reviewStatus moves
    // only when the amount moved.
    const t = svc.slice(svc.indexOf('providerTuition.update'), svc.indexOf('// ── scholarship'));
    expect(t).toMatch(/isActive: true/);
    expect(t).toMatch(/amountChanged \?/);
  });

  it('these rows are group-scoped only — never a bare nationality', () => {
    expect((svc.match(/nationality: null/g) ?? []).length).toBe(2);
    expect(svc).not.toMatch(/nationality: (?!null)[a-z]/i);
  });

  it('the route takes the desired state, so omission is expressible', () => {
    expect(ctrl).toMatch(/@Put\(':id\/group-pricing'\)/);
    expect(ctrl).not.toMatch(/@Delete\(':id\/group-pricing/);
  });
});

describe('the provider programme DTO', () => {
  const dto = read('./dto/provider-programme.dto.ts');
  const FORBIDDEN = [
    'id', 'providerId', 'reviewStatus', 'isActive', 'source', 'sourceRef',
    'isEnglishLanguageCourse', 'facultyId', 'scholarshipNote', 'descriptionFa',
    'careerOutcomes', 'highlights', 'manualVideoIds', 'coverImageUrl',
    'verificationSourceUrl', 'verifiedAt', 'verificationStatus', 'notes',
    'aiPopulated', 'tuitionFeeRaw', 'createdAt', 'updatedAt',
  ];

  it.each(FORBIDDEN)('does not declare %s as an editable field', (field) => {
    expect(new RegExp(`^\\s{2}(declare )?${field}\\??\\s*:`, 'm').test(dto)).toBe(false);
  });

  it('declares exactly the 21 intended fields on the edit shape', () => {
    const shared = dto.slice(dto.indexOf('class ProgrammeContentDto'), dto.indexOf('export class UpdateOwnProgrammeDto'));
    const update = dto.slice(dto.indexOf('export class UpdateOwnProgrammeDto'), dto.indexOf('export class CreateOwnProgrammeDto'));
    const declared = [...(shared + update).matchAll(/^\s{2}([a-zA-Z]+)[!?]?:/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([
      'academicPrerequisites', 'campusCity', 'currency', 'deliveryMode', 'descriptionEn',
      'durationMonths', 'durationText', 'englishRequirementRaw', 'feeBasis', 'feeYear',
      'intakeMonths', 'level', 'majorStrand', 'name', 'nzqfLevel', 'otherRequirements',
      'programmeUrl', 'qualificationType', 'studentVisaSuitable', 'subjectAreaRaw', 'tuitionFeeNZD',
    ]);
    expect(declared.length).toBe(21);
  });

  it('makes the four catalogue-critical fields mandatory on create', () => {
    const create = dto.slice(dto.indexOf('export class CreateOwnProgrammeDto'));
    for (const f of ['name', 'level', 'nzqfLevel', 'intakeMonths']) {
      expect(create).toMatch(new RegExp(`^\\s{2}${f}!:`, 'm'));
    }
  });

  // Both of these were REAL failures, not hypotheticals. `declare` re-typing
  // emits no runtime property, so the decorators never registered and a body
  // with no name reached Prisma and 500'd. The obvious repair — having Create
  // extend Update — fails differently and more quietly: class-validator merges
  // the parent's decorators in, so the parent's @IsOptional keeps the field
  // optional and the requirement is decoration.
  it('never re-types a required field with `declare`', () => {
    expect(dto).not.toMatch(/declare\s+\w+\s*[!?]?:/);
  });

  it('Create does not inherit the optional versions of its required fields', () => {
    expect(dto).not.toMatch(/class CreateOwnProgrammeDto extends UpdateOwnProgrammeDto/);
    expect(dto).toMatch(/class CreateOwnProgrammeDto extends ProgrammeContentDto/);
    // and the shared base must not declare them at all
    const shared = dto.slice(dto.indexOf('class ProgrammeContentDto'), dto.indexOf('export class UpdateOwnProgrammeDto'));
    for (const f of ['name', 'level', 'nzqfLevel', 'intakeMonths']) {
      expect(new RegExp(`^\\s{2}${f}[!?]?:`, 'm').test(shared)).toBe(false);
    }
  });
});

describe('a new programme lands in review, never live', () => {
  const src = read('./provider-programme.service.ts');

  it('states PENDING and inactive rather than trusting the schema default', () => {
    expect(src).toMatch(/reviewStatus: 'PENDING'/);
    expect(src).toMatch(/isActive: false/);
  });

  it('a content edit returns an APPROVED programme to PENDING', () => {
    expect(src).toMatch(/const losesApproval = existing\.reviewStatus === 'APPROVED';/);
    expect(src).toMatch(/if \(losesApproval\) data\.reviewStatus = 'PENDING';/);
  });

  it('an edit that changed nothing writes nothing', () => {
    expect(src).toMatch(/if \(changedFields\.length === 0\) return this\.getOne/);
  });

  it('the activation toggle writes isActive and nothing else', () => {
    const body = src.slice(src.indexOf('async setActive('));
    const data = body.match(/data: \{[^}]*\}/)?.[0] ?? '';
    expect(data).toBe('data: { isActive: active }');
    expect(body).not.toMatch(/reviewStatus:\s*'/);
  });
});

describe('approving a programme no longer publishes it', () => {
  const src = read('../providers/providers.service.ts');

  it('approveProgramme sets reviewStatus only', () => {
    const body = src.slice(src.indexOf('async approveProgramme('), src.indexOf('async rejectProgramme('));
    expect(body).toMatch(/reviewStatus: ReviewStatus\.APPROVED/);
    // The coupling that let an approval republish something an institution had
    // switched off.
    expect(body).not.toMatch(/isActive:\s*true/);
  });
});
