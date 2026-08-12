import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { canReadCase, canAccessCaseFileNote } from './case-access.helper';
import { assertCaseReadable } from './assert-case-read';
import { CaseAccessGuard, CASE_PARAM_KEY } from './case-access.guard';

/**
 * PR-LIA-RESTRICT — an LIA is scoped to the cases they are assigned to.
 *
 * canReadCase said LIA could read every case; canAccessCaseFileNote said the
 * same role on the same case could read only its own. Two gates, one role,
 * opposite answers — and the permissive one governed the wider surface,
 * including legal notes, INZ submissions, visa decisions and payments.
 *
 * Changed 2026-08-12 on the Owner's decision: no cross-case coverage workflow
 * exists, so an LIA who must work another adviser's case is assigned to it.
 *
 * The endpoints are proven through CaseAccessGuard rather than one test per
 * controller. The guard is the thing they share; testing it on a representative
 * set and asserting the wiring separately is what makes the other tests
 * meaningful rather than repetitive.
 */

jest.setTimeout(60000);

describe('LIA case restriction', () => {
  describe('the rule itself', () => {
    const mine = {
      ownerId: null, liaId: 'lia-1', supportId: null, financeId: null, consultantId: null,
    };
    const theirs = { ...mine, liaId: 'lia-2' };
    const unassigned = { ...mine, liaId: null };
    const lia = { userId: 'lia-1', role: 'LIA' };

    it('an LIA reads a case they are assigned to', () => {
      expect(canReadCase(mine, lia)).toBe(true);
    });

    it('an LIA cannot read another adviser’s case', () => {
      expect(canReadCase(theirs, lia)).toBe(false);
    });

    it('an LIA cannot read a case with no adviser assigned', () => {
      // liaId null must not read as "belongs to every LIA".
      expect(canReadCase(unassigned, lia)).toBe(false);
    });

    it('the two case gates now agree about LIA', () => {
      // The bug was that they disagreed. Asserting agreement directly means a
      // future edit to one of them fails here rather than quietly re-opening
      // the gap.
      for (const c of [mine, theirs, unassigned]) {
        expect(canReadCase(c, lia)).toBe(canAccessCaseFileNote(c, lia));
      }
    });

    it('admin tier is unaffected', () => {
      for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) {
        expect(canReadCase(theirs, { userId: 'x', role })).toBe(true);
      }
    });

    it('the other working roles are unchanged', () => {
      const c = {
        ownerId: 'c1', liaId: 'l1', supportId: 's1', financeId: 'f1', consultantId: 'cc1',
      };
      expect(canReadCase(c, { userId: 'c1', role: 'CONSULTANT' })).toBe(true);
      expect(canReadCase(c, { userId: 'cc1', role: 'CLIENT_CONSULTANT' })).toBe(true);
      expect(canReadCase(c, { userId: 's1', role: 'SUPPORT' })).toBe(true);
      expect(canReadCase(c, { userId: 'f1', role: 'FINANCE' })).toBe(true);
      expect(canReadCase(c, { userId: 'nobody', role: 'SUPPORT' })).toBe(false);
    });
  });

  describe('CaseAccessGuard — the shared gate the endpoints run through', () => {
    let prisma: PrismaClient;
    const made = { cases: [] as string[], leads: [] as string[], contacts: [] as string[], users: [] as string[] };

    let liaMine: string, liaOther: string, adminUser: string;
    let caseId: string;

    let seq = 0;
    const stamp = () => `lr${Date.now()}_${(seq += 1)}`;

    async function mkUser(role: string) {
      const s = stamp();
      const u = await prisma.user.create({
        data: {
          name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
          passwordHash: 'x', role: role as any, isActive: true,
        },
      });
      made.users.push(u.id);
      return u.id;
    }

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.$connect();

      liaMine = await mkUser('LIA');
      liaOther = await mkUser('LIA');
      adminUser = await mkUser('ADMIN');

      const s = stamp();
      const c = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
      made.contacts.push(c.id);
      const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW' } as any });
      made.leads.push(l.id);
      const k = await prisma.case.create({ data: { leadId: l.id, liaId: liaMine } as any });
      made.cases.push(k.id);
      caseId = k.id;
    }, 60000);

    afterAll(async () => {
      await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
      await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
      await prisma.$disconnect();
    });

    /** A guard wired the way Nest wires it, with the given route param name. */
    function guardFor(param: string | undefined) {
      const reflector: any = { getAllAndOverride: () => param };
      return new CaseAccessGuard(reflector, prisma as any);
    }

    const ctx = (params: any, user: any): any => ({
      switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
      getHandler: () => null,
      getClass: () => null,
    });

    // The endpoints from the audit, by the param name each one uses. Standing in
    // for legal-notes, visa, contracts, officer-linkage and the rest: they all
    // reach the case through this guard and this param.
    const ROUTES: Array<[string, string]> = [
      ['legal-notes', 'caseId'],
      ['officer-linkage', 'caseId'],
      ['conversation-notes', 'caseId'],
      ['payments case', 'caseId'],
      ['visa', 'id'],
      ['inz-submission', 'id'],
    ];

    it.each(ROUTES)('%s: the assigned LIA still gets through', async (_name, param) => {
      const g = guardFor(param);
      await expect(
        g.canActivate(ctx({ [param]: caseId }, { userId: liaMine, role: 'LIA' })),
      ).resolves.toBe(true);
    });

    it.each(ROUTES)('%s: an unassigned LIA is denied', async (_name, param) => {
      const g = guardFor(param);
      await expect(
        g.canActivate(ctx({ [param]: caseId }, { userId: liaOther, role: 'LIA' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('admin tier is unaffected by the guard', async () => {
      await expect(
        guardFor('caseId').canActivate(ctx({ caseId }, { userId: adminUser, role: 'ADMIN' })),
      ).resolves.toBe(true);
    });

    it('fails closed when the route carries no case id', async () => {
      // A guard that cannot tell which case it is protecting must refuse, not
      // wave the request through — that is how a gate becomes decorative.
      await expect(
        guardFor('caseId').canActivate(ctx({}, { userId: adminUser, role: 'ADMIN' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults to the caseId param when a controller declares none', async () => {
      const g = guardFor(undefined);
      await expect(
        g.canActivate(ctx({ caseId }, { userId: liaMine, role: 'LIA' })),
      ).resolves.toBe(true);
    });

    it('assertCaseReadable agrees with the guard', async () => {
      await expect(
        assertCaseReadable(prisma as any, caseId, { userId: liaOther, role: 'LIA' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('wiring — the guard is actually attached', () => {
    // A guard that works but is not applied protects nothing. These assertions
    // are what make the behavioural tests above mean something for each real
    // endpoint, and they fail loudly if a controller loses the guard.
    //
    // Read from source rather than from Nest's decorator metadata: importing
    // these controllers drags their whole service graph into the test (one of
    // them pulls in an ESM-only sanitiser), which buys nothing here. The risk
    // being guarded against is a controller quietly losing the decorator, and
    // that is visible in the source.
    const read = (f: string) => require('fs').readFileSync(require('path').join(__dirname, f), 'utf8');

    const CLASS_LEVEL: Array<[string, string, string]> = [
      ['case-conversation-notes', '../case-conversation-notes/case-conversation-notes.controller.ts', 'caseId'],
      ['case-messages',           '../case-messages/case-messages.controller.ts', 'caseId'],
      ['legal-notes',             '../legal-notes/legal-notes.controller.ts', 'caseId'],
      ['officer-linkage',         '../immigration-officers/case-officer-linkage.controller.ts', 'caseId'],
      ['inz-data',                '../inz-data/inz-data.controller.ts', 'caseId'],
      ['visa',                    './visa/visa.controller.ts', 'id'],
      ['inz-submission',          './inz-submission/inz-submission.controller.ts', 'id'],
    ];

    it.each(CLASS_LEVEL)('%s has CaseAccessGuard in its class-level @UseGuards', (_n, file) => {
      const src = read(file);
      const m = src.match(/@UseGuards\(([^)]*)\)/);
      expect(m).not.toBeNull();
      expect(m![1]).toContain('CaseAccessGuard');
    });

    it.each(CLASS_LEVEL)('%s declares the case param it actually uses', (_n, file, param) => {
      const src = read(file);
      const declared = src.match(/@CaseParam\('([^']+)'\)/)?.[1] ?? 'caseId';
      expect(declared).toBe(param);
      // And the routes really do use that param name — a declaration pointing at
      // a param no route has would make the guard fail closed on every request.
      expect(src).toMatch(new RegExp(`:${param}[)'/]`));
    });

    it.each([
      ['contracts', '../contracts/contracts.controller.ts', 1],
      ['payments',  '../payments/payments.controller.ts', 4],
    ])('%s guards each of its case-scoped routes', (_n, file, expected) => {
      // These mix case-scoped routes with routes that have no case id (webhooks,
      // paymentId actions), so the guard is per-method and the count matters.
      const src = read(file as string);
      const guarded = (src.match(/@UseGuards\([^)]*CaseAccessGuard[^)]*\)/g) ?? []).length;
      expect(guarded).toBe(expected);
    });

    it('every controller that takes a case id is either guarded or accounted for', () => {
      // The backstop. A new case-scoped controller added later shows up here
      // rather than silently joining the unguarded set.
      const { execSync } = require('child_process');
      const out = execSync(
        'git grep -l -E "@Controller|:caseId" -- "src/**/*.controller.ts"',
        { cwd: require('path').join(__dirname, '..', '..'), encoding: 'utf8' },
      );
      const files = out.split(/\r?\n/).filter(Boolean);
      const unguarded = files.filter((f: string) => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', f), 'utf8');
        return /:caseId|:id\/(visa|inz-submission)/.test(src)
          && /'LIA'/.test(src)
          && !src.includes('CaseAccessGuard')
          && !src.includes('assertCaseReadable');
      });
      // Known and deliberate: these admit LIA and mention a case id but are not
      // case-scoped reads — see the audit notes in each file.
      const ALLOWED = [
        'src/cases/cases.controller.ts',              // routes through cases.service canReadCase
        'src/cases/case-file-note/case-file-note.controller.ts', // canAccessCaseFileNote
        'src/case-documents/case-documents.controller.ts',       // resolveScopedCaseIds
        'src/handoffs/case-handoff.controller.ts',    // holder check in the service
        'src/cases/lia-roster.controller.ts',         // staff directory, not case data
        // The officer directory. ImmigrationOfficerObservation has no caseId —
        // it is intelligence about an INZ officer's decision patterns, shared
        // across advisers on purpose. Re-confirmed against the schema during
        // the LIA restriction, not assumed from the earlier audit.
        'src/immigration-officers/immigration-officers.controller.ts',
      ];
      expect(unguarded.filter((f: string) => !ALLOWED.includes(f))).toEqual([]);
    });
  });
});
