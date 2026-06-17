/**
 * Client portal step 2 — service + controller-metadata + role-guard tests.
 *
 * Service tests: hand-rolled prisma mock, direct construction. Asserts
 * the whitelisted shape, the 404 path, and the explicit-exclusion of
 * every forbidden field.
 *
 * Role-guard tests: instantiate RolesGuard with a Reflector and a
 * mock ExecutionContext that returns the real PortalController class
 * for getClass(). This exercises the real metadata wiring end-to-end
 * without bootstrapping a Nest app.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeService(findFirst: jest.Mock): PortalService {
  return new PortalService({ case: { findFirst } } as any);
}

function makeCtx(role: string): any {
  return {
    getHandler: () => function noop() {},
    getClass:   () => PortalController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 'u1', role } }),
    }),
  };
}

// ─── Service ────────────────────────────────────────────────────────────

describe('PortalService.getMyCase', () => {
  it('returns the whitelisted shape for a client who owns a case', async () => {
    const caseRow = {
      // Whitelisted source fields:
      id:                   'case-1',
      stage:                'ADMISSION',
      status:               'active',
      createdAt:            new Date('2026-06-01T00:00:00Z'),
      updatedAt:            new Date('2026-06-10T00:00:00Z'),
      lia:                  { name: 'Lia Lawyer' },
      owner:                { name: 'Owen Owner' },
      support:              null,
      finance:              null,
      inzApplicationNumber: 'VRC-2026-NZL-12345',
      inzSubmittedAt:       new Date('2026-06-09T00:00:00Z'),
      // Decoy forbidden fields the picker MUST drop:
      notes:                'INTERNAL NOTES — leak detector',
      riskLevel:            'HIGH',
      leadId:               'lead-x',
      ownerId:              'user-owner-internal',
      liaId:                'user-lia-internal',
      supportId:            null,
      financeId:            null,
      inzSubmissionNotes:   'internal-only LIA prose',
      inzReceiptFileUrl:    '/private/path/receipt.pdf',
      inzReceiptFileName:   'receipt.pdf',
      inzReceiptMimeType:   'application/pdf',
      inzReceiptSizeBytes:  12345,
      liaAssignedAt:        new Date('2026-05-30T00:00:00Z'),
    };
    const findFirst = jest.fn().mockResolvedValue(caseRow);
    const service   = makeService(findFirst);

    const result = await service.getMyCase('user-client');

    expect(result).toEqual({
      id:                   'case-1',
      stage:                'ADMISSION',
      status:               'active',
      createdAt:            new Date('2026-06-01T00:00:00Z'),
      updatedAt:            new Date('2026-06-10T00:00:00Z'),
      assignedLia:          { name: 'Lia Lawyer' },
      assignedConsultant:   { name: 'Owen Owner' },
      assignedSupport:      null,
      assignedFinance:      null,
      inzApplicationNumber: 'VRC-2026-NZL-12345',
      inzSubmittedAt:       new Date('2026-06-09T00:00:00Z'),
    });

    // WHERE clause derives the case from the JWT-supplied userId
    // ONLY. The chain Case → lead → contact → userId is the gate.
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ lead: { contact: { userId: 'user-client' } } });

    // ORDER BY createdAt DESC handles "most recent case" if more than one.
    expect(findFirst.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('throws 404 NotFoundException when the client has no case', async () => {
    const service = makeService(jest.fn().mockResolvedValue(null));
    await expect(service.getMyCase('user-no-case')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never includes any forbidden field in the response (no spread leak)', async () => {
    const caseRow = {
      id:                   'case-1',
      stage:                'VISA',
      status:               'active',
      createdAt:            new Date('2026-06-01T00:00:00Z'),
      updatedAt:            new Date('2026-06-10T00:00:00Z'),
      lia:                  null,
      owner:                null,
      support:              null,
      finance:              null,
      inzApplicationNumber: 'VRC-X',
      inzSubmittedAt:       new Date('2026-06-15T00:00:00Z'),
      // Forbidden:
      notes:                'X',
      riskLevel:            'HIGH',
      leadId:               'lead-x',
      ownerId:              'u-internal-1',
      liaId:                'u-internal-2',
      supportId:            'u-internal-3',
      financeId:            'u-internal-4',
      inzSubmissionNotes:   'internal',
      inzReceiptFileUrl:    '/private/path',
      inzReceiptFileName:   'r.pdf',
      inzReceiptMimeType:   'application/pdf',
      inzReceiptSizeBytes:  100,
      liaAssignedAt:        new Date('2026-05-30T00:00:00Z'),
    };
    const service = makeService(jest.fn().mockResolvedValue(caseRow));
    const result  = (await service.getMyCase('user-1')) as Record<string, unknown>;

    const forbidden = [
      'notes', 'riskLevel',
      'leadId', 'ownerId', 'liaId', 'supportId', 'financeId',
      'inzSubmissionNotes', 'inzReceiptFileUrl', 'inzReceiptFileName',
      'inzReceiptMimeType', 'inzReceiptSizeBytes', 'liaAssignedAt',
      // Raw relation names must not leak — only the renamed assigned* keys do.
      'lia', 'owner', 'support', 'finance',
    ];
    for (const key of forbidden) {
      expect(result).not.toHaveProperty(key);
    }

    // Whitelist is exhaustive — exactly these keys, nothing else.
    expect(Object.keys(result).sort()).toEqual([
      'assignedConsultant', 'assignedFinance', 'assignedLia', 'assignedSupport',
      'createdAt', 'id', 'inzApplicationNumber', 'inzSubmittedAt',
      'stage', 'status', 'updatedAt',
    ]);
  });
});

// ─── Role guard ─────────────────────────────────────────────────────────

describe('PortalController role gate', () => {
  it('declares @Roles(LEAD, STUDENT) on the controller class metadata', () => {
    const reflector = new Reflector();
    const roles     = reflector.get<string[]>(ROLES_KEY, PortalController);
    expect(roles).toEqual(['LEAD', 'STUDENT']);
  });

  it('RolesGuard allows LEAD', () => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(makeCtx('LEAD'))).toBe(true);
  });

  it('RolesGuard allows STUDENT', () => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(makeCtx('STUDENT'))).toBe(true);
  });

  it.each([
    ['OWNER'], ['SUPER_ADMIN'], ['ADMIN'],
    ['LIA'], ['CONSULTANT'], ['SUPPORT'], ['FINANCE'],
    ['SALES'], ['OPERATIONS'], ['AGENT'],
  ])('RolesGuard rejects staff role %s with ForbiddenException', (role) => {
    const guard = new RolesGuard(new Reflector());
    expect(() => guard.canActivate(makeCtx(role))).toThrow(ForbiddenException);
  });
});
