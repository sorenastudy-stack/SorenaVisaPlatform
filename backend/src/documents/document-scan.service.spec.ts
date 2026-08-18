import { DocumentScanService } from './document-scan.service';

// PR-AV slice 3 — the after-the-fact scanner for presigned-upload documents.
//
// What matters here is not "does it call the scanner" but the three things that
// would quietly weaken the control if they drifted:
//
//   1. An infected object is DELETED from storage, not merely flagged. This is
//      the only upload path where a bad file ever reaches storage, so the
//      delete is the whole mitigation.
//   2. A scanner outage leaves the row retryable — never CLEAN. Same fail-closed
//      rule as every other upload point, expressed differently because there is
//      no request to refuse.
//   3. A row stuck failing says so ONCE, loudly, rather than never or forever.

const DOC = {
  id: 'doc-1', r2Key: 'case-documents/c1/f.pdf', originalName: 'f.pdf',
  mimeType: 'application/pdf', sizeBytes: 10, caseId: 'c1', uploaderId: 'u1',
  scanAttempts: 0,
};

function harness(opts: {
  verdict?: any;
  bytes?: Buffer | null;
  deleteThrows?: boolean;
  doc?: Partial<typeof DOC>;
}) {
  const updates: any[] = [];
  const audits: any[] = [];
  const deleted: string[] = [];

  const prisma: any = {
    document: {
      findMany: async () => [{ ...DOC, ...(opts.doc ?? {}) }],
      update: async (a: any) => { updates.push(a); return a; },
    },
    auditLog: { create: async (a: any) => { audits.push(a.data); return a; } },
  };
  const r2: any = {
    getObjectBytes: async () => (opts.bytes === undefined ? Buffer.from('x') : opts.bytes),
    deleteObject: async (k: string) => {
      if (opts.deleteThrows) throw new Error('r2 down');
      deleted.push(k);
    },
  };
  const antivirus: any = {
    scanBuffer: async () => opts.verdict ?? { status: 'CLEAN' },
  };
  return { svc: new DocumentScanService(prisma, r2, antivirus), updates, audits, deleted };
}

const dataOf = (updates: any[]) => updates[0]?.data ?? {};

describe('DocumentScanService — verdict handling', () => {
  it('a clean document is marked CLEAN and the object is left alone', async () => {
    const h = harness({ verdict: { status: 'CLEAN' } });
    const r = await h.svc.scanPending();
    expect(r).toMatchObject({ scanned: 1, clean: 1, infected: 0, errored: 0 });
    expect(dataOf(h.updates).scanStatus).toBe('CLEAN');
    expect(h.deleted).toEqual([]);
    expect(h.audits).toEqual([]); // nothing noteworthy happened
  });

  it('an infected document is DELETED from storage and marked INFECTED', async () => {
    const h = harness({ verdict: { status: 'INFECTED', signature: 'Eicar-Test-Signature' } });
    const r = await h.svc.scanPending();
    expect(r).toMatchObject({ infected: 1 });
    expect(h.deleted).toEqual([DOC.r2Key]);           // the actual mitigation
    expect(dataOf(h.updates).scanStatus).toBe('INFECTED');
    expect(dataOf(h.updates).scanSignature).toBe('Eicar-Test-Signature');
  });

  it('the infected audit row does NOT claim the file was never stored', async () => {
    // Every other upload point audits "rejected — not stored". On this path that
    // would be false, and an audit trail that overstates the guarantee is worse
    // than one that admits the difference.
    const h = harness({ verdict: { status: 'INFECTED', signature: 'X' } });
    await h.svc.scanPending();
    const evt = h.audits.find((a) => a.eventType === 'CASE_DOCUMENT_REJECTED_MALWARE');
    expect(evt).toBeDefined();
    expect(evt.newValue.outcome).toMatch(/stored briefly/i);
    expect(evt.newValue.outcome).not.toMatch(/not stored/i);
    expect(evt.newValue.signature).toBe('X');
  });

  it('a failed delete still marks the row INFECTED, and says the object may remain', async () => {
    const h = harness({ verdict: { status: 'INFECTED', signature: 'X' }, deleteThrows: true });
    await h.svc.scanPending();
    expect(dataOf(h.updates).scanStatus).toBe('INFECTED'); // download stays gated
    const evt = h.audits.find((a) => a.eventType === 'CASE_DOCUMENT_REJECTED_MALWARE');
    expect(evt.newValue.outcome).toMatch(/DELETE FAILED/);
  });
});

describe('DocumentScanService — fails closed, never CLEAN by accident', () => {
  it('a scanner outage leaves the row SCAN_ERROR, retryable', async () => {
    const h = harness({ verdict: { status: 'UNAVAILABLE', reason: 'clamd unreachable' } });
    const r = await h.svc.scanPending();
    expect(r).toMatchObject({ errored: 1, clean: 0 });
    expect(dataOf(h.updates).scanStatus).toBe('SCAN_ERROR');
  });

  it('a fetch failure is SCAN_ERROR, not CLEAN', async () => {
    const updates: any[] = [];
    const prisma: any = {
      document: { findMany: async () => [DOC], update: async (a: any) => { updates.push(a); return a; } },
      auditLog: { create: async () => ({}) },
    };
    const r2: any = { getObjectBytes: async () => { throw new Error('network'); }, deleteObject: async () => {} };
    const svc = new DocumentScanService(prisma, r2, { scanBuffer: async () => ({ status: 'CLEAN' }) } as any);
    await svc.scanPending();
    expect(updates[0].data.scanStatus).toBe('SCAN_ERROR');
  });

  it('SCAN_ERROR rows are picked up again by a later pass', async () => {
    // The retry mechanism IS the query — if SCAN_ERROR ever stopped being
    // selected, stuck rows would silently never be revisited.
    let asked: any = null;
    const prisma: any = {
      document: {
        findMany: async (a: any) => { asked = a; return []; },
        update: async () => ({}),
      },
      auditLog: { create: async () => ({}) },
    };
    const svc = new DocumentScanService(prisma, {} as any, {} as any);
    await svc.scanPending();
    expect(asked.where.scanStatus.in).toEqual(
      expect.arrayContaining(['PENDING_SCAN', 'SCAN_ERROR']),
    );
  });

  it('a missing object is parked, not retried forever', async () => {
    const h = harness({ bytes: null });
    await h.svc.scanPending();
    expect(dataOf(h.updates).scanStatus).toBe('SCAN_ERROR');
    expect(dataOf(h.updates).scanAttempts).toBeGreaterThan(10); // past the loud threshold
    expect(h.audits.some((a) => a.eventType === 'CASE_DOCUMENT_SCAN_ERROR')).toBe(true);
  });
});

describe('DocumentScanService — a stuck document is noticed', () => {
  it('says so once, at the threshold', async () => {
    const h = harness({
      verdict: { status: 'UNAVAILABLE', reason: 'clamd unreachable' },
      doc: { scanAttempts: 9 }, // this pass makes it the 10th
    });
    await h.svc.scanPending();
    const stuck = h.audits.filter((a) => a.eventType === 'CASE_DOCUMENT_SCAN_STUCK');
    expect(stuck).toHaveLength(1);
    expect(stuck[0].newValue.attempts).toBe(10);
  });

  it('does not repeat the alarm on every later attempt', async () => {
    const h = harness({
      verdict: { status: 'UNAVAILABLE', reason: 'clamd unreachable' },
      doc: { scanAttempts: 25 },
    });
    await h.svc.scanPending();
    expect(h.audits.filter((a) => a.eventType === 'CASE_DOCUMENT_SCAN_STUCK')).toHaveLength(0);
  });

  it('stays quiet before the threshold', async () => {
    const h = harness({
      verdict: { status: 'UNAVAILABLE', reason: 'clamd unreachable' },
      doc: { scanAttempts: 2 },
    });
    await h.svc.scanPending();
    expect(h.audits).toEqual([]);
  });
});

describe('DocumentScanService — it uses the shared scanner, not its own', () => {
  it('scans through AntivirusService.scanBuffer', async () => {
    let called = false;
    const prisma: any = {
      document: { findMany: async () => [DOC], update: async () => ({}) },
      auditLog: { create: async () => ({}) },
    };
    const svc = new DocumentScanService(
      prisma,
      { getObjectBytes: async () => Buffer.from('x'), deleteObject: async () => {} } as any,
      { scanBuffer: async () => { called = true; return { status: 'CLEAN' }; } } as any,
    );
    await svc.scanPending();
    expect(called).toBe(true);
  });

  it('declares no scanning logic of its own', () => {
    const src = require('fs').readFileSync(require.resolve('./document-scan.service.ts'), 'utf8');
    // No INSTREAM protocol, no socket work — that belongs to AntivirusService.
    expect(src).not.toMatch(/zINSTREAM|createConnection|net\./);
    expect(src).toMatch(/this\.antivirus\.scanBuffer\(/);
  });
});
