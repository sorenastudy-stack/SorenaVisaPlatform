import { NurtureCronService } from './nurture-cron.service';

/**
 * PR-NURTURE-DISARM — the sequence emails are gated off.
 *
 * Steps 1/3/5/6 still contain placeholder copy. Nothing has gone out yet only
 * because no lead has ever become a nurture candidate — which is an accident of
 * the data, not a safeguard, and the harm is one-way: leadNurtureSent marks a
 * step sent forever, so a single accidental send burns that touch permanently.
 *
 * Two things are worth pinning: that the gate is OFF unless explicitly enabled,
 * and that a suppressed send writes nothing to the ledger.
 */

describe('Nurture sweep is disarmed by default', () => {
  const original = process.env.NURTURE_SWEEP_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.NURTURE_SWEEP_ENABLED;
    else process.env.NURTURE_SWEEP_ENABLED = original;
    jest.resetModules();
  });

  it('the cron does not run the sweep when the flag is unset', async () => {
    delete process.env.NURTURE_SWEEP_ENABLED;
    jest.resetModules();
    const { NurtureCronService: Fresh } = await import('./nurture-cron.service');
    const nurture: any = { runDailySweep: jest.fn() };
    const svc = new Fresh(nurture);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.runDailySweep();
    expect(nurture.runDailySweep).not.toHaveBeenCalled();
  });

  it('says so in the log rather than passing silently', async () => {
    // A job that quietly does nothing is indistinguishable from one that is
    // broken, and this one is meant to come back.
    delete process.env.NURTURE_SWEEP_ENABLED;
    jest.resetModules();
    const { NurtureCronService: Fresh } = await import('./nurture-cron.service');
    const svc = new Fresh({ runDailySweep: jest.fn() } as any);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.runDailySweep();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/NURTURE_SWEEP_ENABLED/);
  });

  it('a value other than "true" is still off', async () => {
    // Guards against a half-set flag ("1", "yes") reading as enabled.
    process.env.NURTURE_SWEEP_ENABLED = '1';
    jest.resetModules();
    const { NurtureCronService: Fresh } = await import('./nurture-cron.service');
    const nurture: any = { runDailySweep: jest.fn() };
    const svc = new Fresh(nurture);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.runDailySweep();
    expect(nurture.runDailySweep).not.toHaveBeenCalled();
  });

  it('runs when explicitly enabled', async () => {
    process.env.NURTURE_SWEEP_ENABLED = 'true';
    jest.resetModules();
    const { NurtureCronService: Fresh } = await import('./nurture-cron.service');
    const nurture: any = {
      runDailySweep: jest.fn().mockResolvedValue({
        processed: 0, emailsSent: 0, callTasksCreated: 0, ended: 0, newslettersSent: 0,
      }),
    };
    const svc = new Fresh(nurture);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});

    await svc.runDailySweep();
    expect(nurture.runDailySweep).toHaveBeenCalledTimes(1);
  });
});

describe('A suppressed sequence email leaves no trace in the ledger', () => {
  it('never writes leadNurtureSent while disarmed', async () => {
    // The critical property. leadNurtureSent is the dedup anchor: a row written
    // here would permanently prevent the real copy from ever reaching that lead.
    delete process.env.NURTURE_SWEEP_ENABLED;
    jest.resetModules();
    const { NurtureService } = await import('./nurture.service');

    const create = jest.fn();
    const findUnique = jest.fn();
    const sendNurtureSequenceEmail = jest.fn();
    const prisma: any = { leadNurtureSent: { create, findUnique } };
    const svc: any = new NurtureService(prisma, { sendNurtureSequenceEmail } as any);
    jest.spyOn(svc.logger, 'warn').mockImplementation(() => {});

    const sent = await svc.ensureEmailSent('lead-1', 1, 'a@b.test', 'A', 'cta', 'unsub');

    expect(sent).toBe(false);
    expect(sendNurtureSequenceEmail).not.toHaveBeenCalled();
    // Neither the send NOR the record — the record is the irreversible half.
    expect(create).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
