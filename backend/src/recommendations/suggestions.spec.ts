import { SUGGESTION_COUNT } from './recommendations.service';

// PR-RECS-PHASE1 — the invariants that make the Apply/Study suggestions safe.
//
// The behavioural end-to-end (a real student, a real choice, exactly 5
// suggestions, none ineligible) runs against a live server; these pin the
// decisions that a future edit could quietly undo.

describe('suggestion count', () => {
  it('is 5', () => {
    expect(SUGGESTION_COUNT).toBe(5);
  });

  // The one that matters. CountryExecutionConfig.slotCount is ALSO 5 today, so a
  // future reader could reasonably assume they are the same knob and "tidy up"
  // by pointing one at the other. They are not the same question: slotCount is
  // how many programmes a student may CHOOSE; SUGGESTION_COUNT is how many we
  // SUGGEST. Raising the choice limit must not silently change how much we steer.
  it('is a separate constant from slotCount, not derived from it', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(require.resolve('./recommendations.service'), 'utf8'),
    );
    // The suggestion count must not be read from the country config anywhere in
    // this service.
    expect(src).toContain('SUGGESTION_COUNT = 5');
    expect(src).not.toMatch(/SUGGESTION_COUNT\s*=\s*[^;]*slotCount/);
    expect(src).not.toMatch(/slice\(0,\s*[^)]*slotCount/);
  });
});

describe('the read-only guarantee', () => {
  it('the suggestions path never writes a programme choice', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(require.resolve('./recommendations.service'), 'utf8'),
    );
    const method = src.slice(
      src.indexOf('async getSuggestionsForAdmission'),
      src.indexOf("// Sort a shaped item list"),
    );
    expect(method.length).toBeGreaterThan(200);
    // A suggestion is not a commitment: no create/update/delete of a choice.
    expect(method).not.toMatch(/admissionProgrammeChoice\.(create|update|upsert|delete)/);
    // The only admissionProgrammeChoice access is the READ that gates on timing.
    expect(method).toMatch(/admissionProgrammeChoice\.findMany/);
  });

  it('returns nothing at all before the student has chosen', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(require.resolve('./recommendations.service'), 'utf8'),
    );
    const method = src.slice(
      src.indexOf('async getSuggestionsForAdmission'),
      src.indexOf("// Sort a shaped item list"),
    );
    // The empty-choice branch must return BEFORE any list is fetched or built,
    // so suggestions cannot precede the student's own decision.
    const guardIdx = method.indexOf('NO_CHOICE_YET');
    const listIdx = method.indexOf('getCurrentForCase');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(listIdx);
  });
});

describe('explanations', () => {
  it('passes the deterministic whyThisFits through without generating prose', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(require.resolve('./recommendations.service'), 'utf8'),
    );
    // No model call anywhere in this service.
    expect(src).not.toMatch(/openai|anthropic|\.complete\(|generateProse|llm/i);
  });
});
