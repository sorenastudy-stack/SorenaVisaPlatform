import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { assertCaseReadable } from './assert-case-read';

// PR-LIA-RESTRICT — the per-case gate, as a guard.
//
// canReadCase existed and was correct, and exactly one service called it. Every
// other case-scoped surface — legal notes, INZ submissions, visa decisions,
// conversation notes, payments, officer linkage — was gated by role alone: the
// route asked "is this an LIA?" and never "on this client?". While LIA meant
// "sees every case" that gap was invisible, because the answer would have been
// yes anyway.
//
// A guard rather than a call in each method, because the failure mode being
// fixed is someone forgetting the call. A method added to a guarded controller
// tomorrow is covered without anyone remembering to do anything.

export const CASE_PARAM_KEY = 'case_access_param';

/**
 * Which route parameter holds the case id. Defaults to `caseId`.
 * Controllers that name it `id` declare `@CaseParam('id')`.
 */
export const CaseParam = (name: string) => SetMetadata(CASE_PARAM_KEY, name);

@Injectable()
export class CaseAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const param =
      this.reflector.getAllAndOverride<string | undefined>(CASE_PARAM_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? 'caseId';

    const req = ctx.switchToHttp().getRequest();
    const caseId = req.params?.[param];

    // FAIL CLOSED. A guarded route with no case id in it is a misapplied guard,
    // and the safe reading of "I cannot tell which case this is" is not "then
    // let it through" — that is precisely how a gate becomes decorative.
    if (!caseId) {
      throw new NotFoundException('Case not found');
    }

    await assertCaseReadable(this.prisma, caseId, {
      userId: req.user?.userId ?? req.user?.id,
      role: req.user?.role,
    });
    return true;
  }
}
