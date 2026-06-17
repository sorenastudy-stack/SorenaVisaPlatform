/**
 * Documents step 3 — unit tests for the documents service + DTO.
 *
 * Pattern matches auth.service.spec.ts: direct construction with
 * hand-rolled Jest mocks. PrismaService and R2Service are both
 * mocked end-to-end — no real network/DB calls.
 */

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentsService } from './documents.service';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  RequestUploadDto,
} from './dto/request-upload.dto';

// ─── Helpers ────────────────────────────────────────────────────────────

interface CaseShape {
  id: string;
  liaId: string | null;
  ownerId: string | null;
  supportId: string | null;
  financeId: string | null;
  lead: { contact: { userId: string | null } } | null;
}

interface DocumentShape {
  id: string;
  caseId: string;
  status: 'PENDING' | 'UPLOADED' | 'FAILED';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  r2Key: string;
  category?: string | null;
  createdAt?: Date;
  uploaderId?: string;
  uploader?: { name: string } | null;
}

function buildMocks(opts: {
  case?: CaseShape | null;
  document?: DocumentShape | null;
  documents?: Array<DocumentShape>;
}) {
  const prismaMock: any = {};
  prismaMock.case = {
    findUnique: jest.fn().mockResolvedValue(opts.case ?? null),
  };
  prismaMock.document = {
    create: jest.fn(async ({ data }: any) => ({
      id: 'doc-new-id',
      r2Key: data.r2Key,
    })),
    findUnique: jest.fn().mockResolvedValue(opts.document ?? null),
    update: jest.fn(async ({ data, select }: any) => {
      const base = opts.document ?? {
        id: 'doc-x',
        caseId: 'case-x',
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        status: 'PENDING',
        r2Key: 'cases/x/x.pdf',
        category: null,
        createdAt: new Date('2026-06-17T00:00:00Z'),
      };
      return {
        ...base,
        ...data,
        // Mirror Prisma's select projection — only return requested keys.
        ...(select ? {} : {}),
      };
    }),
    delete: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue(opts.documents ?? []),
  };
  prismaMock.auditLog = {
    create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };
  prismaMock.$transaction = jest.fn(async (cb: any) => cb(prismaMock));

  const r2Mock: any = {
    bucketName: 'test-bucket',
    getPresignedUploadUrl: jest
      .fn()
      .mockResolvedValue('https://r2.example/upload?sig=abc'),
    getPresignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://r2.example/download?sig=xyz'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };

  return { prisma: prismaMock, r2: r2Mock };
}

function makeService(mocks: {
  prisma: any;
  r2: any;
}): DocumentsService {
  return new DocumentsService(mocks.prisma, mocks.r2);
}

const STUDENT_ACTOR = { id: 'user-student', name: 'Student', role: 'STUDENT' as string | null };
const LEAD_ACTOR    = { id: 'user-lead',    name: 'Lead',    role: 'LEAD'    as string | null };
const ADMIN_ACTOR   = { id: 'user-admin',   name: 'Admin',   role: 'ADMIN'   as string | null };
const LIA_ACTOR     = { id: 'user-lia',     name: 'Lia',     role: 'LIA'     as string | null };

const CASE_WITH_STUDENT: CaseShape = {
  id: 'case-1',
  liaId: 'user-lia',
  ownerId: null,
  supportId: null,
  financeId: null,
  lead: { contact: { userId: 'user-student' } },
};

const CASE_WITH_OTHER_CLIENT: CaseShape = {
  id: 'case-2',
  liaId: null,
  ownerId: null,
  supportId: null,
  financeId: null,
  lead: { contact: { userId: 'someone-else' } },
};

const VALID_REQUEST = {
  originalName: 'passport.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 12345,
};

// ─── DTO validation tests ────────────────────────────────────────────────

describe('RequestUploadDto (validation)', () => {
  it('accepts a valid pdf', async () => {
    const dto = plainToInstance(RequestUploadDto, VALID_REQUEST);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a disallowed mimeType (text/plain) with a clear message', async () => {
    const dto = plainToInstance(RequestUploadDto, {
      ...VALID_REQUEST,
      mimeType: 'text/plain',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const mimeErr = errors.find((e) => e.property === 'mimeType');
    expect(mimeErr).toBeDefined();
    const msgs = Object.values(mimeErr!.constraints ?? {}).join(' ');
    expect(msgs).toMatch(/mimeType must be one of/);
  });

  it('rejects an oversized file (16 MiB > 15 MiB cap)', async () => {
    const dto = plainToInstance(RequestUploadDto, {
      ...VALID_REQUEST,
      sizeBytes: 16 * 1024 * 1024,
    });
    const errors = await validate(dto);
    const sizeErr = errors.find((e) => e.property === 'sizeBytes');
    expect(sizeErr).toBeDefined();
    const msgs = Object.values(sizeErr!.constraints ?? {}).join(' ');
    expect(msgs).toMatch(/15 MiB/);
  });

  it('accepts the exact 15 MiB boundary', async () => {
    const dto = plainToInstance(RequestUploadDto, {
      ...VALID_REQUEST,
      sizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('exposes the canonical allow-list (sanity)', () => {
    expect(ALLOWED_DOCUMENT_MIME_TYPES).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
  });
});

// ─── Service tests ──────────────────────────────────────────────────────

describe('DocumentsService.requestUpload', () => {
  it('creates a PENDING Document row and returns an uploadUrl', async () => {
    const mocks = buildMocks({ case: CASE_WITH_STUDENT });
    const service = makeService(mocks);
    const res = await service.requestUpload(
      'case-1',
      VALID_REQUEST as any,
      ADMIN_ACTOR,
    );

    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    const createArgs = mocks.prisma.document.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('PENDING');
    expect(createArgs.data.caseId).toBe('case-1');
    expect(createArgs.data.uploaderId).toBe('user-admin');
    expect(createArgs.data.r2Key).toMatch(/^cases\/case-1\/[a-f0-9-]+-passport\.pdf$/);

    expect(mocks.r2.getPresignedUploadUrl).toHaveBeenCalledWith(
      createArgs.data.r2Key,
      'application/pdf',
      300,
    );

    expect(res).toEqual({
      documentId: 'doc-new-id',
      uploadUrl: 'https://r2.example/upload?sig=abc',
      r2Key: createArgs.data.r2Key,
      expiresInSeconds: 300,
    });

    // No audit row at this stage — audit fires on confirm.
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws 403 when the case is not visible to the actor', async () => {
    // A LEAD user pointed at a case whose contact.userId is someone else.
    const mocks = buildMocks({ case: CASE_WITH_OTHER_CLIENT });
    const service = makeService(mocks);

    await expect(
      service.requestUpload('case-2', VALID_REQUEST as any, LEAD_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    expect(mocks.r2.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('throws 404 when the case does not exist', async () => {
    const mocks = buildMocks({ case: null });
    const service = makeService(mocks);
    await expect(
      service.requestUpload('case-missing', VALID_REQUEST as any, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.confirmUpload', () => {
  it('flips PENDING → UPLOADED and writes exactly one audit row in a transaction', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1',
        caseId: 'case-1',
        status: 'PENDING',
        originalName: 'passport.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        r2Key: 'cases/case-1/xyz-passport.pdf',
      },
    });
    const service = makeService(mocks);
    await service.confirmUpload('case-1', 'doc-1', STUDENT_ACTOR);

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1' },
        data: { status: 'UPLOADED' },
      }),
    );

    // Exactly one audit row, with the expected discriminators.
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.eventType).toBe('DOCUMENT_UPLOADED');
    expect(audit.action).toBe('DOCUMENT_UPLOAD');
    expect(audit.entityType).toBe('DOCUMENT');
    expect(audit.entityId).toBe('doc-1');
    expect(audit.userId).toBe('user-student');
    expect(audit.newValue).toMatchObject({
      caseId: 'case-1',
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      r2Key: 'cases/case-1/xyz-passport.pdf',
    });
    expect(audit.actorNameSnapshot).toBe('Student');
    expect(audit.actorRoleSnapshot).toBe('STUDENT');
  });

  it('rejects confirm for a doc not on this case (404)', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1',
        caseId: 'case-OTHER',
        status: 'PENDING',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        r2Key: 'k',
      },
    });
    await expect(
      makeService(mocks).confirmUpload('case-1', 'doc-1', ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects confirm for a doc that is already UPLOADED (400)', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1',
        caseId: 'case-1',
        status: 'UPLOADED',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        r2Key: 'k',
      },
    });
    await expect(
      makeService(mocks).confirmUpload('case-1', 'doc-1', ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DocumentsService.listDocuments', () => {
  it('returns only UPLOADED rows and never includes r2Key', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      documents: [
        {
          id: 'doc-a',
          caseId: 'case-1',
          status: 'UPLOADED',
          originalName: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          r2Key: 'should-not-appear-in-response',
          category: 'passport',
          createdAt: new Date('2026-06-17T01:00:00Z'),
          uploaderId: 'user-x',
          uploader: { name: 'Alice' },
        },
      ],
    });
    const service = makeService(mocks);
    const rows = await service.listDocuments('case-1', LIA_ACTOR);

    // The findMany filter must restrict to status=UPLOADED.
    const where = mocks.prisma.document.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ caseId: 'case-1', status: 'UPLOADED' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'doc-a',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      category: 'passport',
      status: 'UPLOADED',
      createdAt: new Date('2026-06-17T01:00:00Z'),
      uploaderId: 'user-x',
      uploaderName: 'Alice',
    });
    expect((rows[0] as Record<string, unknown>).r2Key).toBeUndefined();
  });

  it('throws 403 for a non-admin user with no slot and no client linkage', async () => {
    const mocks = buildMocks({ case: CASE_WITH_OTHER_CLIENT });
    const service = makeService(mocks);
    const stranger = { id: 'user-stranger', name: 'X', role: 'SUPPORT' as string | null };
    await expect(
      service.listDocuments('case-2', stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentsService.getDownloadUrl', () => {
  it('returns a signed url and writes one audit row', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1',
        caseId: 'case-1',
        status: 'UPLOADED',
        originalName: 'p.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        r2Key: 'cases/case-1/k',
      },
    });
    const service = makeService(mocks);
    const res = await service.getDownloadUrl('case-1', 'doc-1', LIA_ACTOR);

    expect(mocks.r2.getPresignedDownloadUrl).toHaveBeenCalledWith('cases/case-1/k', 300);
    expect(res).toEqual({
      url: 'https://r2.example/download?sig=xyz',
      expiresInSeconds: 300,
    });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.eventType).toBe('DOCUMENT_DOWNLOAD_URL_ISSUED');
    expect(audit.entityType).toBe('DOCUMENT');
    expect(audit.entityId).toBe('doc-1');
    expect(audit.newValue).toMatchObject({ caseId: 'case-1', fileName: 'p.pdf' });
  });

  it('404s when the doc is still PENDING', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1', caseId: 'case-1', status: 'PENDING',
        originalName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 1, r2Key: 'k',
      },
    });
    await expect(
      makeService(mocks).getDownloadUrl('case-1', 'doc-1', ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.deleteDocument', () => {
  it('forbids delete for a LEAD on their own case (403 + DOCUMENT_ACCESS_DENIED audit)', async () => {
    const mocks = buildMocks({
      // Lead's id matches the case's contact.userId — they ARE the client.
      case: { ...CASE_WITH_STUDENT, lead: { contact: { userId: 'user-lead' } } },
      document: {
        id: 'doc-1', caseId: 'case-1', status: 'UPLOADED',
        originalName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 1, r2Key: 'k',
      },
    });
    const service = makeService(mocks);
    await expect(
      service.deleteDocument('case-1', 'doc-1', LEAD_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Exactly one DOCUMENT_ACCESS_DENIED audit row, and no R2 delete attempted.
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.eventType).toBe('DOCUMENT_ACCESS_DENIED');
    expect(audit.action).toBe('DOCUMENT_ACCESS_DENIED');
    expect(audit.entityType).toBe('CASE');
    expect(audit.entityId).toBe('case-1');
    expect(audit.userId).toBe('user-lead');
    expect(audit.newValue).toMatchObject({
      attemptedDocumentId: 'doc-1',
      endpoint: expect.stringContaining('DELETE'),
    });
    expect(mocks.r2.deleteObject).not.toHaveBeenCalled();
    expect(mocks.prisma.document.delete).not.toHaveBeenCalled();
  });

  it('allows delete for ADMIN: calls R2.deleteObject, then deletes the row, then audits', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1', caseId: 'case-1', status: 'UPLOADED',
        originalName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 1,
        r2Key: 'cases/case-1/k',
      },
    });
    const service = makeService(mocks);
    const res = await service.deleteDocument('case-1', 'doc-1', ADMIN_ACTOR);

    expect(mocks.r2.deleteObject).toHaveBeenCalledWith('cases/case-1/k');
    expect(mocks.prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.eventType).toBe('DOCUMENT_REMOVED');
    expect(audit.action).toBe('DOCUMENT_DELETE');
    expect(audit.entityType).toBe('DOCUMENT');
    expect(audit.oldValue).toMatchObject({
      caseId: 'case-1',
      fileName: 'p.pdf',
      r2Key: 'cases/case-1/k',
    });
    expect(res).toEqual({ deleted: true });
  });

  it('does NOT delete the row if R2 deletion fails (returns 500)', async () => {
    const mocks = buildMocks({
      case: CASE_WITH_STUDENT,
      document: {
        id: 'doc-1', caseId: 'case-1', status: 'UPLOADED',
        originalName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 1,
        r2Key: 'cases/case-1/k',
      },
    });
    mocks.r2.deleteObject.mockRejectedValueOnce(new Error('R2 boom'));
    const service = makeService(mocks);

    await expect(
      service.deleteDocument('case-1', 'doc-1', ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(mocks.prisma.document.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('DOCUMENT_ACCESS_DENIED audit on denied LEAD attempt (cross-case)', () => {
  it('a LEAD touching someone else\'s case → 403 + exactly one DOCUMENT_ACCESS_DENIED row', async () => {
    const mocks = buildMocks({ case: CASE_WITH_OTHER_CLIENT });
    const service = makeService(mocks);

    await expect(
      service.listDocuments('case-2', LEAD_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Single denial audit, with the endpoint label captured.
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('DOCUMENT_ACCESS_DENIED');
    expect(audit.eventType).toBe('DOCUMENT_ACCESS_DENIED');
    expect(audit.entityType).toBe('CASE');
    expect(audit.entityId).toBe('case-2');
    expect(audit.userId).toBe('user-lead');
    expect(audit.actorRoleSnapshot).toBe('LEAD');
    expect(audit.newValue).toMatchObject({
      attemptedDocumentId: null,
      endpoint: expect.stringContaining('GET /cases/:caseId/documents'),
    });

    // List was NOT executed against the docs table — denial fired first.
    expect(mocks.prisma.document.findMany).not.toHaveBeenCalled();
  });
});
