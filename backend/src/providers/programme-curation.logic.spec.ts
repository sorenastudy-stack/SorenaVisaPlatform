import {
  activationTarget, decideDeactivation, changedFields, matchingBlockedReason, type StudentHold,
} from './programme-curation.logic';

describe('activationTarget — one switch, both gates', () => {
  it('Active sets BOTH fields the matching engine requires', () => {
    expect(activationTarget(true)).toEqual({ reviewStatus: 'APPROVED', isActive: true });
  });

  it('Inactive returns to PENDING, never REJECTED', () => {
    // REJECTED means "reviewed and refused". Switching off is not a rejection,
    // and the Owner must be able to switch it back on.
    expect(activationTarget(false)).toEqual({ reviewStatus: 'PENDING', isActive: false });
  });
});

describe('decideDeactivation — warn, never silently allow or block', () => {
  const holds: StudentHold[] = [
    { admissionApplicationId: 'a1', studentName: 'A Student', caseReference: 'CASE-1' },
    { admissionApplicationId: 'a2', studentName: null, caseReference: null },
  ];

  it('blocks the first attempt and reports who is affected', () => {
    const d = decideDeactivation(false, holds, false);
    expect(d.allowed).toBe(false);
    expect(d.requiresConfirmation).toBe(true);
    expect(d.affected).toHaveLength(2);
    expect(d.message).toMatch(/2 students have/);
  });

  it('allows it once the Owner confirms', () => {
    const d = decideDeactivation(false, holds, true);
    expect(d.allowed).toBe(true);
    expect(d.requiresConfirmation).toBe(false);
  });

  it('does not warn when nobody has chosen the programme', () => {
    expect(decideDeactivation(false, [], false)).toMatchObject({ allowed: true, requiresConfirmation: false });
  });

  it('never gates ACTIVATION — switching on cannot invalidate a choice', () => {
    expect(decideDeactivation(true, holds, false)).toMatchObject({ allowed: true, requiresConfirmation: false });
  });

  it('uses singular wording for one student', () => {
    expect(decideDeactivation(false, [holds[0]], false).message).toMatch(/1 student has/);
  });
});

describe('changedFields — the audit records real edits only', () => {
  const before = { name: 'Diploma in Cookery', tuitionFeeNZD: 22000, campusCity: 'Auckland', intakeMonths: [2, 7], notes: null };

  it('records only what actually changed', () => {
    expect(changedFields(before, { name: 'Diploma in Cookery', tuitionFeeNZD: 23000 }))
      .toEqual({ tuitionFeeNZD: { from: 22000, to: 23000 } });
  });

  it('treats a cleared text field as a real change', () => {
    expect(changedFields(before, { campusCity: null })).toEqual({ campusCity: { from: 'Auckland', to: null } });
  });

  it('does not log an empty string over an existing null as a change', () => {
    expect(changedFields(before, { notes: '' })).toEqual({});
  });

  it('skips fields that were not submitted', () => {
    expect(changedFields(before, { name: undefined })).toEqual({});
  });

  it('compares arrays by value, not identity', () => {
    expect(changedFields(before, { intakeMonths: [2, 7] })).toEqual({});
    expect(changedFields(before, { intakeMonths: [2, 7, 11] }))
      .toEqual({ intakeMonths: { from: [2, 7], to: [2, 7, 11] } });
  });

  it('an untouched save records nothing', () => {
    expect(changedFields(before, { ...before })).toEqual({});
  });

  // Defence in depth: this must hold without relying on ValidationPipe's
  // whitelist stripping the DTO at the HTTP boundary.
  it('ignores fields outside the editable allow-list', () => {
    const b = { ...before, reviewStatus: 'PENDING', isActive: false, sourceRef: 'ITP:row12', providerId: 'p1' };
    const attempted = { reviewStatus: 'APPROVED', isActive: true, sourceRef: 'HACKED', providerId: 'p2', coverImageUrl: 'x' };
    expect(changedFields(b as any, attempted as any)).toEqual({});
  });

  it('still records a legitimate edit submitted alongside a blocked one', () => {
    const b = { ...before, sourceRef: 'ITP:row12' };
    expect(changedFields(b as any, { campusCity: 'Hamilton', sourceRef: 'HACKED' } as any))
      .toEqual({ campusCity: { from: 'Auckland', to: 'Hamilton' } });
  });
});

describe('matchingBlockedReason — explain the invisible provider-level gate', () => {
  const active = { reviewStatus: 'APPROVED', isActive: true };

  it('warns when the programme is Active but the institution is not under contract', () => {
    expect(matchingBlockedReason(active, 'PENDING')).toMatch(/not marked as under contract/);
  });

  it('is silent once the institution is ACTIVE', () => {
    expect(matchingBlockedReason(active, 'ACTIVE')).toBeNull();
  });

  it('is silent for an inactive programme — nothing to explain', () => {
    expect(matchingBlockedReason({ reviewStatus: 'PENDING', isActive: false }, 'PENDING')).toBeNull();
  });
});
