import { ForbiddenException } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';

/**
 * PR-ACCESS-AUDIT — whose workload a staff member may look at.
 *
 * The scoping itself was already here and already correct: non-admin staff got
 * their own numbers. What was missing was any test saying so, which is why the
 * audit could not tell a deliberate rule from an accident.
 *
 * Two defects went with it, neither of them a leak:
 *
 *   * the admin check compared req.user.role directly, so a user granted ADMIN
 *     as a SECONDARY role was refused a view their role entitles them to —
 *     every other gate in this codebase widens with secondaryRoles;
 *
 *   * asking for someone else's workload was answered silently with your own.
 *     The page then showed one person's numbers under another person's name.
 *     A wrong answer is worse than a refusal.
 *
 * The service is a stub: what is under test is the decision about which staffId
 * reaches it, not what it counts.
 */

describe('GET /api/staff/assignments/workload — whose workload', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';

  let asked: string[];
  let controller: AssignmentsController;

  beforeEach(() => {
    asked = [];
    const service: any = {
      getStaffWorkload: jest.fn(async (id: string) => {
        asked.push(id);
        return { staffId: id };
      }),
    };
    controller = new AssignmentsController(service);
  });

  const req = (role: string, secondaryRoles: string[] = []) =>
    ({ user: { userId: ME, role, secondaryRoles } });

  it('gives a non-admin their own workload when they ask for nothing', async () => {
    await controller.getWorkload(req('SUPPORT'), {});
    expect(asked).toEqual([ME]);
  });

  it('lets a non-admin ask for their own workload explicitly', async () => {
    await controller.getWorkload(req('SUPPORT'), { staffId: ME });
    expect(asked).toEqual([ME]);
  });

  it('refuses a non-admin asking for someone else’s', async () => {
    await expect(
      controller.getWorkload(req('CONSULTANT'), { staffId: OTHER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // And refuses it — does not quietly answer with the caller's own numbers.
    expect(asked).toEqual([]);
  });

  it.each(['OWNER', 'SUPER_ADMIN', 'ADMIN'])(
    '%s can see anyone’s workload',
    async (role) => {
      await controller.getWorkload(req(role), { staffId: OTHER });
      expect(asked).toEqual([OTHER]);
    },
  );

  it.each(['SUPPORT', 'FINANCE', 'LIA', 'CONSULTANT', 'CLIENT_CONSULTANT'])(
    '%s cannot see anyone else’s workload',
    async (role) => {
      await expect(
        controller.getWorkload(req(role), { staffId: OTHER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('a SECONDARY admin role widens a scoped one', async () => {
    await controller.getWorkload(req('SUPPORT', ['ADMIN']), { staffId: OTHER });
    expect(asked).toEqual([OTHER]);
  });

  it('a secondary role that is not admin tier does not widen', async () => {
    await expect(
      controller.getWorkload(req('SUPPORT', ['FINANCE']), { staffId: OTHER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
