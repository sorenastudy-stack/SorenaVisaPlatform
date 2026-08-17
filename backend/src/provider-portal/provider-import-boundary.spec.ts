import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL slice C — the upload boundary, asserted as source properties.
//
// The behavioural proof (a real institution uploading a real file, and a real
// second institution named in the sheet's Brand column) runs against a live
// server. These are the checks that hold when nobody is looking — each one fails
// if a later edit quietly widens the boundary, which is the change that would
// not look dangerous in review.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');

describe('the staff import routes stay closed to a PROVIDER token', () => {
  const src = read('../providers/providers.controller.ts');

  // The absence test. A working wrapper proves nothing if the staff controller
  // also answers an institution — that would be the cross-tenant leak, since
  // every import route there takes the target from `:id`.
  it('no @Roles list on the staff controller contains PROVIDER', () => {
    const roleLists = src.match(/@Roles\([^)]*\)/g) ?? [];
    expect(roleLists.length).toBeGreaterThan(5); // the file really was scanned
    expect(roleLists.filter((r) => /['"]PROVIDER['"]/.test(r))).toEqual([]);
  });

  it('the three import routes are PROVIDER_ADMIN, i.e. staff-only', () => {
    for (const route of ['import-programmes', 'scholarships/import', 'tuitions/import']) {
      const at = src.indexOf(`@Post(':id/${route}')`);
      expect(at).toBeGreaterThan(-1);
      // The decorator immediately after the route declaration.
      expect(src.slice(at, at + 200)).toMatch(/@Roles\(\.\.\.PROVIDER_ADMIN\)/);
    }
  });

  it('PROVIDER_ADMIN is OWNER/SUPER_ADMIN and nothing else', () => {
    expect(src).toMatch(/const PROVIDER_ADMIN = \['OWNER', 'SUPER_ADMIN'\] as const;/);
  });
});

describe('the provider upload controller cannot be told whose rows these are', () => {
  const src = read('./provider-import.controller.ts');

  it('declares no route with a path parameter', () => {
    const routes = src.match(/@Post\(([^)]*)\)/g) ?? [];
    expect(routes.length).toBe(6);
    expect(routes.filter((r) => r.includes(':'))).toEqual([]);
  });

  it('never reads an id from params, query or body', () => {
    expect(src).not.toMatch(/@Param\(/);
    expect(src).not.toMatch(/@Query\(/);
    expect(src).not.toMatch(/@Body\(/);
  });

  it('takes the institution only from the guard-resolved identity', () => {
    expect(src).toMatch(/providerId: req\.providerAccess\.providerId/);
  });

  it('is guarded by JwtAuthGuard, RolesGuard AND ProviderAccessGuard', () => {
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard,\s*ProviderAccessGuard\)/);
    expect(src).toMatch(/@Roles\('PROVIDER'\)/);
  });

  it('rate-limits every one of the six upload routes', () => {
    expect((src.match(/@Throttle\(UPLOAD_LIMIT\)/g) ?? []).length).toBe(6);
  });
});

describe('an external upload is constrained more tightly than a staff one', () => {
  const src = read('./provider-import.service.ts');

  it('accepts .xlsx only — no macro-enabled .xlsm, no legacy .xls', () => {
    const decl = src.match(/const PROVIDER_EXT = .*/)?.[0] ?? '';
    expect(decl).toContain('xlsx');
    expect(decl).not.toContain('xlsm');
    expect(decl).not.toMatch(/\bxls\b/);
    // and the check is actually applied to the uploaded name
    expect(src).toMatch(/!PROVIDER_EXT\.test\(file\.originalname\)/);
  });

  it('caps the upload size itself, since the programme importer does not', () => {
    expect(src).toMatch(/MAX_BYTES = 5 \* 1024 \* 1024/);
    expect(src).toMatch(/if \(size > MAX_BYTES\)/);
  });

  it('validates before dispatching, never after', () => {
    const body = src.slice(src.indexOf('async run('));
    expect(body.indexOf('assertProviderFile')).toBeLessThan(body.indexOf('dispatch('));
  });

  it('passes the guard-resolved providerId to every importer', () => {
    for (const call of [/importProgrammes\(actor\.providerId/, /importTuitions\(actor\.providerId/, /importScholarships\(actor\.providerId/]) {
      expect(src).toMatch(call);
    }
  });

  it('audits dry runs too, not only committed uploads', () => {
    expect(src).toMatch(/await this\.audit\(kind, actor, file, dryRun, result\)/);
    expect(src).toMatch(/PROVIDER_SELF_IMPORT/);
  });
});

describe('the Brand column cannot redirect a row to another institution', () => {
  const src = read('../providers/import/programme-import.service.ts');

  it('ignores Brand entirely when a providerId was supplied', () => {
    // `let providerId = opts.providerId` and the Brand lookup sits behind
    // `if (!providerId)`. If that guard is ever removed, a provider's sheet
    // could name a competitor and rows would attach there.
    expect(src).toMatch(/let providerId = opts\.providerId;\s*\n\s*if \(!providerId\) \{/);
    const brandAt = src.indexOf("row['Brand']");
    const guardAt = src.indexOf('if (!providerId) {');
    const guardEnd = src.indexOf('const campus', guardAt);
    expect(brandAt).toBeGreaterThan(guardAt);
    expect(brandAt).toBeLessThan(guardEnd);
  });

  it('the pricing importers never look at a provider name in the sheet at all', () => {
    for (const f of ['./../providers/import/tuition-import.logic.ts', './../providers/import/scholarship-import.logic.ts']) {
      expect(read(f)).not.toMatch(/\bBrand\b/);
    }
  });
});

describe('a changed price loses its approval', () => {
  const src = read('../providers/import/pricing-import.service.ts');

  // A schema @default applies on CREATE only, so the update branch had to say
  // this explicitly — without it an approved row could be silently re-priced.
  it('the tuition update path re-pends when the figures change', () => {
    expect(src).toMatch(/const figuresChanged =/);
    expect(src).toMatch(/\.\.\.\(figuresChanged \? \{ reviewStatus: 'PENDING' as const \} : \{\}\)/);
  });

  it('compares the amount, the currency, the term and the notes', () => {
    const block = src.slice(src.indexOf('const figuresChanged ='), src.indexOf('await this.prisma.providerTuition.update'));
    for (const field of ['amountValue', 'currency', 'term', 'notes']) {
      expect(block).toContain(field);
    }
  });

  it('reads those fields back, or it could not compare them', () => {
    expect(src).toMatch(/select: \{ id: true, amountValue: true, currency: true, term: true, notes: true \}/);
  });
});
