import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-WALLET slice 1 — client store-credit wallet service.
//
// The append-only WalletTransaction ledger is the source of truth; the
// Wallet.balanceCents column is a cache kept in lock-step with it inside one
// DB transaction. ALL money is INTEGER cents — never floats. `postTransaction`
// is the single primitive that later slices (tiered refund credit, booking
// spend) compose with by passing a Prisma transaction client.

type Tx = Prisma.TransactionClient;

interface PostParams {
  userId: string;
  amountCents: number; // signed: + credit / − spend
  type: WalletTransactionType;
  createdById: string;
  reason?: string;
  relatedConsultationId?: string;
  relatedPaymentId?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's wallet, created on first access (balance 0). */
  async getOrCreate(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true, userId: true, balanceCents: true, currency: true },
    });
  }

  /** Balance + recent ledger, for the client wallet view. */
  async getBalanceAndLedger(userId: string, take = 100) {
    const wallet = await this.getOrCreate(userId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, amountCents: true, type: true, balanceAfterCents: true,
        reason: true, relatedConsultationId: true, createdAt: true,
      },
    });
    return { balanceCents: wallet.balanceCents, currency: wallet.currency, transactions };
  }

  /**
   * Post one ledger entry AND update the cached balance atomically.
   * `amountCents` is signed. Runs inside the caller's transaction when `tx`
   * is supplied (so refund/booking flows stay atomic), else opens its own.
   * Refuses non-integer/zero amounts and any debit that would go negative.
   */
  async postTransaction(params: PostParams, tx?: Tx) {
    if (!Number.isInteger(params.amountCents) || params.amountCents === 0) {
      throw new BadRequestException('amountCents must be a non-zero integer (cents)');
    }
    const run = async (db: Tx) => {
      // Ensure the wallet row exists (first-access create), then take a
      // row-level lock and read the authoritative balance UNDER the lock.
      // Without `FOR UPDATE`, two concurrent posts on the same wallet both
      // read the same balance and the second write clobbers the first
      // (lost update → double-spend / wrong balance). The lock serialises
      // them for the life of the enclosing transaction. PR-WALLET slice 3.
      const base = await db.wallet.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId },
        update: {},
        select: { id: true },
      });
      const locked = await db.$queryRaw<Array<{ balanceCents: number }>>`
        SELECT "balanceCents" FROM "wallet" WHERE "id" = ${base.id} FOR UPDATE`;
      const currentBalance = Number(locked[0].balanceCents);
      const nextBalance = currentBalance + params.amountCents;
      if (nextBalance < 0) {
        throw new BadRequestException('Insufficient wallet balance');
      }
      const entry = await db.walletTransaction.create({
        data: {
          walletId: base.id,
          amountCents: params.amountCents,
          type: params.type,
          balanceAfterCents: nextBalance,
          reason: params.reason ?? null,
          relatedConsultationId: params.relatedConsultationId ?? null,
          relatedPaymentId: params.relatedPaymentId ?? null,
          createdById: params.createdById,
        },
        select: { id: true },
      });
      await db.wallet.update({ where: { id: base.id }, data: { balanceCents: nextBalance } });
      return { transactionId: entry.id, balanceCents: nextBalance };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Convenience: post a positive credit. (Used by slice 2 tiered refunds.) */
  credit(params: Omit<PostParams, 'amountCents'> & { amountCents: number }, tx?: Tx) {
    return this.postTransaction({ ...params, amountCents: Math.abs(params.amountCents) }, tx);
  }

  /** Convenience: post a negative spend. (Used by slice 3 booking spend.) */
  debit(params: Omit<PostParams, 'amountCents'> & { amountCents: number }, tx?: Tx) {
    return this.postTransaction({ ...params, amountCents: -Math.abs(params.amountCents) }, tx);
  }
}
