import { DocumentsService } from './documents.service';

// PR-AV slice 3 — the download gate.
//
// After-the-fact scanning is only safe because this endpoint refuses to hand out
// a URL for anything that is not CLEAN. The bucket is private and no public
// domain is bound to it, so this is the single door: if it opens for a
// PENDING_SCAN or INFECTED row, the whole slice is decorative.

const BASE = {
  id: 'doc-1',
  caseId: 'case-1',
  status: 'UPLOADED',
  r2Key: 'case-documents/case-1/f.pdf',
  originalName: 'f.pdf',
};

function harness(scanStatus: string) {
  const issued: string[] = [];
  const prisma: any = {
    document: { findUnique: async () => ({ ...BASE, scanStatus }) },
    auditLog: { create: async () => ({}) },
    // assertAccess path — the caller is allowed; this spec is about scan state.
    case: { findUnique: async () => ({ id: 'case-1', ownerId: 'u1', liaId: null, supportId: null, financeId: null, consultantId: null }) },
  };
  const r2: any = {
    getPresignedDownloadUrl: async (k: string) => { issued.push(k); return 'https://signed.example/x'; },
  };
  const svc = new DocumentsService(prisma, r2);
  // Access control is proven by its own suite; neutralise it here so a failure
  // in THIS spec can only mean the scan gate misbehaved.
  (svc as any).assertAccess = async () => undefined;
  return { svc, issued };
}

const actor = { id: 'u1', name: 'Owner', role: 'OWNER' };
const call = (svc: DocumentsService) => svc.getDownloadUrl('case-1', 'doc-1', actor);

describe('getDownloadUrl refuses anything not CLEAN', () => {
  it('CLEAN — issues a URL', async () => {
    const h = harness('CLEAN');
    const res: any = await call(h.svc);
    expect(res.url ?? res.downloadUrl).toBeTruthy();
    expect(h.issued).toEqual([BASE.r2Key]);
  });

  it('PENDING_SCAN — refuses, and says it is still processing', async () => {
    const h = harness('PENDING_SCAN');
    await expect(call(h.svc)).rejects.toMatchObject({
      response: { message: 'This document is still being processed. Please try again in a moment.' },
    });
    expect(h.issued).toEqual([]);   // no URL was minted
  });

  it('INFECTED — refuses, and says it is no longer available', async () => {
    const h = harness('INFECTED');
    await expect(call(h.svc)).rejects.toMatchObject({
      response: { message: 'This document is no longer available.' },
    });
    expect(h.issued).toEqual([]);
  });

  it('SCAN_ERROR — refuses, and invites a retry', async () => {
    const h = harness('SCAN_ERROR');
    await expect(call(h.svc)).rejects.toMatchObject({
      response: { message: 'We could not retrieve that document right now. Please try again shortly.' },
    });
    expect(h.issued).toEqual([]);
  });

  it('the three refusals are distinct, and none mentions a scanner', async () => {
    const msgs: string[] = [];
    for (const st of ['PENDING_SCAN', 'INFECTED', 'SCAN_ERROR']) {
      try { await call(harness(st).svc); } catch (e: any) { msgs.push(e.response?.message ?? e.message); }
    }
    expect(new Set(msgs).size).toBe(3);
    for (const m of msgs) {
      expect(m).not.toMatch(/scan|virus|malware|clam|infected|signature/i);
    }
  });
});
