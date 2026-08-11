import { Reflector } from '@nestjs/core';
import { RequestMethod, UseGuards, Get, Post, Controller } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';
import { RolesAccessService } from './roles-access.service';
import { Roles } from '../../auth/decorators/roles.decorator';

// PR-ROLES-REFERENCE — the report is only useful if it is TRUE.
//
// The failure that matters is not a crash: it is the report quietly disagreeing
// with the guard, because then an access review is done against fiction. So
// these tests drive the real service over real decorated controllers and check
// that what comes out matches what the decorators say.
//
// The open-vs-authenticated split gets its own test because getting it wrong is
// how this page would cry wolf — flagging every ordinary logged-in route as
// unprotected, and burying the genuinely public ones in the noise.

class JwtAuthGuard {}
class ThrottlerGuard {}

@Controller('demo')
@UseGuards(JwtAuthGuard)
class DemoController {
  @Get('owner-only')
  @Roles('OWNER')
  a() {}

  @Post('shared')
  @Roles('OWNER', 'SALES')
  b() {}

  // Authenticated (controller-level JwtAuthGuard) but no role restriction.
  @Get('any-signed-in')
  c() {}

  notARoute() {}
}

@Controller('open')
@UseGuards(ThrottlerGuard)
class OpenController {
  // Throttling is not identification: this is reachable by anyone.
  @Post('signup')
  d() {}
}

describe('RolesAccessService', () => {
  let service: RolesAccessService;

  const discovery: any = {
    getControllers: () => [
      { instance: new DemoController(), metatype: DemoController },
      { instance: new OpenController(), metatype: OpenController },
      // A wrapper with no instance (Nest emits these) must not crash the scan.
      { instance: null, metatype: null },
    ],
  };

  beforeEach(() => {
    service = new RolesAccessService(discovery, new MetadataScanner(), new Reflector());
  });

  const build = () => service.build(['OWNER', 'SALES', 'LIA']);

  it('lists a route under every role its @Roles names, and no others', () => {
    const r = build();
    const owner = r.roles.find((x) => x.role === 'OWNER')!;
    const sales = r.roles.find((x) => x.role === 'SALES')!;

    expect(owner.routes.map((x) => x.path).sort()).toEqual(['/demo/owner-only', '/demo/shared']);
    // SALES is on the shared route only — the report must not over-report access.
    expect(sales.routes.map((x) => x.path)).toEqual(['/demo/shared']);
    expect(owner.routes.find((x) => x.path === '/demo/shared')!.method).toBe('POST');
  });

  it('shows a role with no grants rather than omitting it', () => {
    // "This role can reach nothing" is usually the answer someone came for;
    // dropping the row would read as "not checked".
    const lia = build().roles.find((x) => x.role === 'LIA')!;
    expect(lia).toBeDefined();
    expect(lia.routeCount).toBe(0);
  });

  it('separates "signed in, any role" from "open to the internet"', () => {
    const r = build();
    expect(r.authenticatedAnyRole.map((x) => x.path)).toEqual(['/demo/any-signed-in']);
    // ThrottlerGuard limits abuse but does not identify a caller.
    expect(r.openRoutes.map((x) => x.path)).toEqual(['/open/signup']);
  });

  it('records the guards actually applied, so a reader can judge for themselves', () => {
    const r = build();
    expect(r.authenticatedAnyRole[0].guards).toContain('JwtAuthGuard');
    expect(r.openRoutes[0].guards).toContain('ThrottlerGuard');
  });

  it('ignores class methods that are not routes', () => {
    const r = build();
    const all = [
      ...r.roles.flatMap((x) => x.routes),
      ...r.authenticatedAnyRole,
      ...r.openRoutes,
    ];
    expect(all.some((x) => x.path.includes('notARoute'))).toBe(false);
  });

  it('carries the authored description alongside the derived routes', () => {
    // The prose is authored and the routes are derived; the page shows both, so
    // the report has to keep them attached to the same role.
    const owner = build().roles.find((x) => x.role === 'OWNER')!;
    expect(owner.responsibilities).toMatch(/owner/i);
  });
});
