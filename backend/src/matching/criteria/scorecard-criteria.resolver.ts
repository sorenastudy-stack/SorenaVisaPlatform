import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { MatchCriteriaResolver, ResolvedCriteria } from './match-criteria-resolver';
import { buildCriteriaFromScorecardAnswers, type ScorecardAnswers } from './scorecard-field-reverse-map';

// PR-RECS-1 (slice 1) — Impl A of the resolveMatchCriteria seam.
//
// Reads the student's latest real /scorecard submission, decrypts the answers
// (existing CryptoService path), and reverse-maps them to a MatchCriteria. The
// reverse-map is intentionally lossy + conservative (documented in
// scorecard-field-reverse-map.ts). Returns null when the student has no submitted
// scorecard (caller surfaces "complete your assessment first").
@Injectable()
export class ScorecardCriteriaResolver implements MatchCriteriaResolver {
  private readonly logger = new Logger(ScorecardCriteriaResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async resolve(studentUserId: string): Promise<ResolvedCriteria | null> {
    const submission = await this.prisma.scorecardSubmission.findFirst({
      where: { userId: studentUserId, isDraft: false },
      orderBy: { submittedAt: 'desc' },
      select: { answersEncrypted: true },
    });
    if (!submission) return null;

    let answers: ScorecardAnswers;
    try {
      const raw = submission.answersEncrypted as unknown as Buffer | Uint8Array;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      answers = JSON.parse(this.crypto.decrypt(buf)) as ScorecardAnswers;
    } catch (e) {
      // Corrupt/unreadable ciphertext — fail soft (no list) rather than throw.
      this.logger.warn(`Could not decrypt scorecard answers for user ${studentUserId}: ${(e as Error).message}`);
      return null;
    }

    // StudyField key → id (the reverse-map yields a key; the matcher needs the id).
    const fields = await this.prisma.studyField.findMany({ select: { id: true, key: true } });
    const idByKey = Object.fromEntries(fields.map((f) => [f.key, f.id]));

    // Nationality from the student's OWN Contact (Contact.userId is @unique) — the
    // authoritative source, and the same Contact the case chain uses. The
    // scorecard submission's leadId is nullable, so don't depend on it.
    const contact = await this.prisma.contact.findFirst({ where: { userId: studentUserId }, select: { nationality: true } });
    const nationality = contact?.nationality ?? undefined;

    const criteria = buildCriteriaFromScorecardAnswers(answers, idByKey, nationality);
    return { criteria, source: 'SCORECARD' };
  }
}
