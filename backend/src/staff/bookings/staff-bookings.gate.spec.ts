/**
 * Regression test for the "My Meetings shows nothing for a Client Officer" bug.
 *
 * Root cause was NOT the data or the query — it was the role gate: the
 * /staff/bookings endpoint omitted CLIENT_CONSULTANT from its @StaffRoles
 * allow-list, so a Client Officer (e.g. Aydin) got a 403 that the UI renders as
 * "No meetings yet". These tests pin the gate (must admit CLIENT_CONSULTANT) and
 * prove the service returns that staff member's own bookings once allowed.
 */

import 'reflect-metadata';
import { STAFF_ROLES_KEY } from '../roles/staff-roles.decorator';
import { StaffBookingsController } from './staff-bookings.controller';
import { StaffBookingsService } from './staff-bookings.service';

describe('StaffBookingsController — GET /staff/bookings role gate', () => {
  it('admits CLIENT_CONSULTANT (Client Officer) — the fix', () => {
    const roles: string[] =
      Reflect.getMetadata(STAFF_ROLES_KEY, StaffBookingsController.prototype.list) ?? [];
    expect(roles).toContain('CLIENT_CONSULTANT');
    // the other consultation-running roles remain gated in
    expect(roles).toEqual(
      expect.arrayContaining(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT']),
    );
  });
});

describe('StaffBookingsService.list — scoping', () => {
  it("scopes a non-admin (Client Officer) to their own assignedToId and returns their bookings", async () => {
    const now = new Date('2026-07-23T00:00:00.000Z');
    const consultRow = {
      id: 'cmrwn26650001o2015z55iajm',
      type: 'FREE_15',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      amountNZD: 0,
      paidWith: null,
      stripePaymentId: null,
      scheduledAt: new Date('2026-07-24T22:30:00.000Z'),
      bookingTimezone: 'Pacific/Auckland',
      assignedToId: 'aydin-id',
      assignedTo: { name: 'Aydin Tashvighi' },
      lead: { contact: { fullName: 'haniyeh Modiri', user: { name: 'Haniyeh' } } },
    };
    const findMany = jest.fn().mockResolvedValue([consultRow]);
    const walletFindMany = jest.fn();
    const prisma: any = {
      consultation: { findMany },
      walletTransaction: { findMany: walletFindMany },
    };
    const service = new StaffBookingsService(prisma, {} as any);

    const out = await service.list({ userId: 'aydin-id', role: 'CLIENT_CONSULTANT' }, now);

    // The query is scoped to the caller's own assignedToId (not admin-wide).
    const where = findMany.mock.calls[0][0].where;
    expect(where.assignedToId).toBe('aydin-id');

    // It returns his booking, with the client's name.
    expect(out).toHaveLength(1);
    expect(out[0].clientName).toBe('haniyeh Modiri');
    expect(out[0].status).toBe('CONFIRMED');

    // A non-admin never runs the wallet-credit query and is never card-refundable.
    expect(walletFindMany).not.toHaveBeenCalled();
    expect(out[0].cardRefundable).toBe(false);
  });

  it('an admin is NOT filtered by assignedToId (sees all)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = {
      consultation: { findMany },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StaffBookingsService(prisma, {} as any);

    await service.list({ userId: 'admin-id', role: 'ADMIN' });

    const where = findMany.mock.calls[0][0].where;
    expect(where.assignedToId).toBeUndefined();
  });
});
