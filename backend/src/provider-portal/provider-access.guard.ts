import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProviderAccess } from './provider-access.helper';

// PR-PROVIDER-PORTAL slice B — the gate, as a guard.
//
// Resolves the caller's OWN institution from the JWT and attaches it to the
// request as `req.providerAccess`. Every route on the provider controller reads
// the id from there; none of them accepts one from the caller.
//
// WHY THE ID IS ATTACHED HERE rather than looked up per route: a route that does
// its own lookup is a route that can forget to, and the failure mode is silent
// cross-tenant reads of competitively sensitive pricing. One lookup, one place.
//
// A blocked provider is told WHY (403 with the reason) rather than given a bare
// refusal, for the same reason the agent guard does: a person who cannot get in
// and cannot find out why goes to support with a question nobody can answer.
@Injectable()
export class ProviderAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.userId ?? req.user?.id;

    const access = await resolveProviderAccess(this.prisma, userId);
    if (!access.allowed) {
      throw new ForbiddenException(
        access.blockedReasons.includes('NO_PROVIDER_RECORD')
          ? 'This login is not linked to an institution.'
          : 'Your institution is not active. Contact Sorena if you think this is wrong.',
      );
    }

    req.providerAccess = access;
    return true;
  }
}
