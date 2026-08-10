import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Connection attempts are spread over ~1 minute. Sized against the thing that
// actually happens: a managed-Postgres restart or failover, which takes tens of
// seconds. Long enough to ride one out, short enough that a genuinely
// misconfigured DATABASE_URL still fails the deploy rather than hanging it.
const CONNECT_ATTEMPTS = 10;
const BACKOFF_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 8_000, 8_000, 8_000, 8_000];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
  }

  /**
   * Connect, retrying while the database is unreachable.
   *
   * WHY: a single unretried $connect() here took production down for twenty
   * minutes. Postgres restarted, this process happened to boot during the gap,
   * $connect() threw P1001, Nest aborted the bootstrap and the container
   * exited. Postgres came back healthy seconds later — but nothing was left
   * alive to notice, and Railway disables the Restart button on a crashed
   * deployment, so recovery needed a human to push a redeploy.
   *
   * The database being briefly unreachable is a normal event. Treating it as a
   * fatal one is what turned it into an outage.
   */
  async onModuleInit() {
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Database connected after ${attempt} attempts`);
        else this.logger.log('Database connected');
        return;
      } catch (err: any) {
        const last = attempt === CONNECT_ATTEMPTS;
        if (last) {
          // Still fatal in the end — a permanently wrong DATABASE_URL must fail
          // the deploy loudly rather than leave a process up that can serve
          // nothing.
          this.logger.error(
            `Database unreachable after ${CONNECT_ATTEMPTS} attempts over ` +
            `${Math.round(BACKOFF_MS.reduce((a, b) => a + b, 0) / 1000)}s: ${err?.message ?? err}`,
          );
          throw err;
        }
        const wait = BACKOFF_MS[attempt - 1];
        this.logger.warn(
          `Database not reachable (attempt ${attempt}/${CONNECT_ATTEMPTS}), retrying in ${wait}ms — ` +
          `${err?.errorCode ?? err?.message ?? err}`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
