/* eslint-disable no-console */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { planAttributionBackfill, type AttributionTouch, type AttributionValues } from './lib/utm-attribution-backfill';

const APPLY_CONFIRMATION = '--confirm=BACKFILL_UTM';
const ROLLBACK_CONFIRMATION = '--confirm=ROLLBACK_UTM';

async function main() {
  const apply = process.argv.includes('--apply');
  const rollbackArg = process.argv.find((arg) => arg.startsWith('--rollback='));
  if (apply && rollbackArg) throw new Error('Choose either --apply or --rollback, not both.');
  if (apply && !process.argv.includes(APPLY_CONFIRMATION)) {
    throw new Error(`Apply requires ${APPLY_CONFIRMATION}`);
  }
  if (rollbackArg && !process.argv.includes(ROLLBACK_CONFIRMATION)) {
    throw new Error(`Rollback requires ${ROLLBACK_CONFIRMATION}`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    if (rollbackArg) {
      await rollback(prisma, rollbackArg.slice('--rollback='.length));
      return;
    }
    await auditOrApply(prisma, apply);
  } finally {
    await app.close();
  }
}

async function auditOrApply(prisma: PrismaService, apply: boolean) {
  const runId = randomUUID();
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { utmSource: null }, { utmMedium: null }, { utmCampaign: null },
        { firstTouchSource: null }, { lastTouchSource: null },
      ],
    },
    select: {
      id: true, sourceChannel: true, utmSource: true, utmMedium: true, utmCampaign: true,
      firstTouchSource: true, lastTouchSource: true,
      scorecardSubmissions: {
        where: { isDraft: false },
        select: { submittedAt: true, utmSource: true, utmMedium: true, utmCampaign: true },
      },
      webinarRegistrations: {
        select: { createdAt: true, utmSource: true, utmMedium: true, utmCampaign: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const candidates: Array<{ leadId: string; oldValue: AttributionValues; proposal: Partial<AttributionValues> }> = [];
  for (const lead of leads) {
    const touches: AttributionTouch[] = [
      ...lead.scorecardSubmissions.map((s) => ({
        occurredAt: s.submittedAt, channel: 'SCORECARD' as const,
        utmSource: s.utmSource, utmMedium: s.utmMedium, utmCampaign: s.utmCampaign,
      })),
      ...lead.webinarRegistrations.map((w) => ({
        occurredAt: w.createdAt, channel: 'WEBSITE_WEBINAR' as const,
        utmSource: w.utmSource, utmMedium: w.utmMedium, utmCampaign: w.utmCampaign,
      })),
    ];
    const oldValue: AttributionValues = {
      utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
      firstTouchSource: lead.firstTouchSource, lastTouchSource: lead.lastTouchSource,
    };
    const proposal = planAttributionBackfill(oldValue, touches);
    if (Object.keys(proposal).length > 0) candidates.push({ leadId: lead.id, oldValue, proposal });
  }

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN', runId, scannedLeads: leads.length,
    candidateLeads: candidates.length, sample: candidates.slice(0, 10),
  }, null, 2));

  if (!apply) return;
  let applied = 0;
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      // Re-read inside the write transaction. A genuine conversion may have
      // populated a field after the initial audit query; never overwrite it.
      const current = await tx.lead.findUnique({ where: { id: candidate.leadId }, select: {
        utmSource: true, utmMedium: true, utmCampaign: true,
        firstTouchSource: true, lastTouchSource: true,
      } });
      if (!current) return;
      const safeProposal = Object.fromEntries(
        Object.entries(candidate.proposal).filter(([key]) => (current as any)[key] == null),
      );
      if (Object.keys(safeProposal).length === 0) return;
      await tx.lead.update({ where: { id: candidate.leadId }, data: safeProposal as Prisma.LeadUpdateInput });
      await tx.auditLog.create({
        data: {
          action: 'UPDATE', eventType: 'LEAD_ATTRIBUTION_BACKFILLED', entityType: 'LEAD', entityId: candidate.leadId,
          oldValue: current as unknown as Prisma.InputJsonValue,
          newValue: { runId, proposal: safeProposal } as unknown as Prisma.InputJsonValue,
          actorNameSnapshot: 'backfill-lead-attribution', actorRoleSnapshot: 'SYSTEM',
        },
      });
      applied++;
    });
  }
  console.log(JSON.stringify({ status: 'BACKFILL_SUCCESS', runId, applied }));
}

async function rollback(prisma: PrismaService, runId: string) {
  const audits = await prisma.auditLog.findMany({
    where: { eventType: 'LEAD_ATTRIBUTION_BACKFILLED', entityType: 'LEAD' },
    orderBy: { createdAt: 'desc' },
  });
  const matching = audits.filter((a) => (a.newValue as any)?.runId === runId);
  let restored = 0;
  for (const audit of matching) {
    if (!audit.entityId || !audit.oldValue) continue;
    const proposal = (audit.newValue as any)?.proposal as Partial<AttributionValues>;
    const current = await prisma.lead.findUnique({ where: { id: audit.entityId }, select: {
      utmSource: true, utmMedium: true, utmCampaign: true, firstTouchSource: true, lastTouchSource: true,
    } });
    if (!current) continue;
    const unchangedSinceApply = Object.entries(proposal).every(([key, value]) => (current as any)[key] === value);
    if (!unchangedSinceApply) {
      console.warn(`[skip] ${audit.entityId}: attribution changed after backfill; manual review required`);
      continue;
    }
    const restore = Object.fromEntries(Object.keys(proposal).map((key) => [key, (audit.oldValue as any)[key]]));
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: audit.entityId! }, data: restore as Prisma.LeadUpdateInput });
      await tx.auditLog.create({ data: {
        action: 'UPDATE', eventType: 'LEAD_ATTRIBUTION_BACKFILL_ROLLED_BACK', entityType: 'LEAD', entityId: audit.entityId,
        oldValue: current as unknown as Prisma.InputJsonValue,
        newValue: { runId, restoredFromAuditId: audit.id, restore } as unknown as Prisma.InputJsonValue,
        actorNameSnapshot: 'backfill-lead-attribution', actorRoleSnapshot: 'SYSTEM',
      } });
    });
    restored++;
  }
  console.log(JSON.stringify({ status: 'ROLLBACK_COMPLETE', runId, eligible: matching.length, restored }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
