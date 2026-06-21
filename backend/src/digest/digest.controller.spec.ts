/**
 * Phase 8 — DigestController unit tests.
 *
 * Direct construction + mock DigestService. Tests cover:
 *   - the date-window defaulting (no body → last 7 days)
 *   - explicit since/until override is honoured
 *   - since < until validation
 *   - actor extraction from req.user
 *   - response surfaces the service result verbatim
 *   - role gate is configured (Roles metadata on the handler)
 */

import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DigestController } from './digest.controller';

function makeController(opts: {
  triggerResult?: { sent: boolean; reason?: 'case-not-found' | 'no-email'; itemCount: number };
  triggerImpl?:   (caseId: string, since: Date, until: Date, actor: any) => Promise<any>;
} = {}) {
  const trigger = jest.fn(
    opts.triggerImpl ?? (async () => opts.triggerResult ?? { sent: true, itemCount: 0 }),
  );
  const digestServiceMock: any = { triggerManualDigest: trigger };
  const controller = new DigestController(digestServiceMock);
  return { controller, trigger };
}

const STAFF_ACTOR = { userId: 'admin-1', name: 'Admin One', role: 'ADMIN' };
const REQ = { user: STAFF_ACTOR };

describe('DigestController.sendOne', () => {

  // ─── Default 7-day window ───────────────────────────────────────────

  it('defaults to the last 7 days when both since and until are omitted', async () => {
    const { controller, trigger } = makeController();
    const before = Date.now();
    const result = await controller.sendOne('case-1', {}, REQ);
    const after = Date.now();

    expect(result).toEqual({ sent: true, itemCount: 0 });
    expect(trigger).toHaveBeenCalledTimes(1);
    const [caseId, since, until, actor] = trigger.mock.calls[0];
    expect(caseId).toBe('case-1');

    // until should be ~now (between before and after).
    expect(until.getTime()).toBeGreaterThanOrEqual(before);
    expect(until.getTime()).toBeLessThanOrEqual(after);

    // since should be exactly 7 days before until.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(until.getTime() - since.getTime()).toBe(SEVEN_DAYS_MS);

    // Actor extracted from req.user.
    expect(actor).toEqual({ id: 'admin-1', name: 'Admin One', role: 'ADMIN' });
  });

  // ─── Explicit overrides ─────────────────────────────────────────────

  it('honours explicit since + until ISO overrides', async () => {
    const { controller, trigger } = makeController();
    await controller.sendOne(
      'case-1',
      { since: '2026-06-01T00:00:00Z', until: '2026-06-08T00:00:00Z' },
      REQ,
    );
    const [, since, until] = trigger.mock.calls[0];
    expect(since.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(until.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('honours since-only override; until defaults to now', async () => {
    const { controller, trigger } = makeController();
    const before = Date.now();
    await controller.sendOne('case-1', { since: '2026-06-01T00:00:00Z' }, REQ);
    const after = Date.now();
    const [, since, until] = trigger.mock.calls[0];
    expect(since.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(until.getTime()).toBeGreaterThanOrEqual(before);
    expect(until.getTime()).toBeLessThanOrEqual(after);
  });

  it('honours until-only override; since is anchored to until - 7 days', async () => {
    const { controller, trigger } = makeController();
    await controller.sendOne('case-1', { until: '2026-06-08T00:00:00Z' }, REQ);
    const [, since, until] = trigger.mock.calls[0];
    expect(until.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    // Anchored: since = until - 7 days (the week ending the override).
    // This is what makes the manual trigger usable for back-tests.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(until.getTime() - since.getTime()).toBe(SEVEN_DAYS_MS);
    expect(since.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  // ─── Validation ─────────────────────────────────────────────────────

  it('rejects since >= until with BadRequestException', async () => {
    const { controller, trigger } = makeController();
    await expect(
      controller.sendOne(
        'case-1',
        { since: '2026-06-08T00:00:00Z', until: '2026-06-01T00:00:00Z' },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('rejects since === until with BadRequestException (empty window is not meaningful)', async () => {
    const { controller, trigger } = makeController();
    await expect(
      controller.sendOne(
        'case-1',
        { since: '2026-06-01T00:00:00Z', until: '2026-06-01T00:00:00Z' },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('rejects malformed since with BadRequestException', async () => {
    const { controller, trigger } = makeController();
    await expect(
      controller.sendOne('case-1', { since: 'definitely not a date' }, REQ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(trigger).not.toHaveBeenCalled();
  });

  // ─── Response wiring ────────────────────────────────────────────────

  it('returns the service result verbatim (sent: true with itemCount)', async () => {
    const { controller } = makeController({ triggerResult: { sent: true, itemCount: 5 } });
    const result = await controller.sendOne('case-1', {}, REQ);
    expect(result).toEqual({ sent: true, itemCount: 5 });
  });

  it('returns the service result verbatim (sent: false with reason)', async () => {
    const { controller } = makeController({
      triggerResult: { sent: false, reason: 'no-email', itemCount: 0 },
    });
    const result = await controller.sendOne('case-missing', {}, REQ);
    expect(result).toEqual({ sent: false, reason: 'no-email', itemCount: 0 });
  });

  // ─── Role gate is configured on the handler ─────────────────────────

  it('the sendOne handler has @Roles("OWNER","ADMIN","SUPER_ADMIN") metadata', () => {
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(ROLES_KEY, DigestController.prototype.sendOne);
    expect(roles).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
  });
});
