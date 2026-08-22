/* eslint-disable no-console */
// Production-runtime version. Deliberately plain CommonJS so Railway can run
// it with the installed `node` + `@prisma/client`; no dev-only ts-node needed.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const prisma = new PrismaClient();
const APPLY_CONFIRMATION = '--confirm=BACKFILL_UTM';
const ROLLBACK_CONFIRMATION = '--confirm=ROLLBACK_UTM';

function plan(current, touches) {
  const ordered = [...touches].sort((a, b) => a.occurredAt - b.occurredAt);
  if (!ordered.length) return {};
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstCampaign = ordered.find((t) => t.utmSource || t.utmMedium || t.utmCampaign);
  const proposal = {};
  if (!current.utmSource && firstCampaign?.utmSource) proposal.utmSource = firstCampaign.utmSource;
  if (!current.utmMedium && firstCampaign?.utmMedium) proposal.utmMedium = firstCampaign.utmMedium;
  if (!current.utmCampaign && firstCampaign?.utmCampaign) proposal.utmCampaign = firstCampaign.utmCampaign;
  if (!current.firstTouchSource) proposal.firstTouchSource = first.utmSource || first.channel;
  if (!current.lastTouchSource) proposal.lastTouchSource = last.utmSource || last.channel;
  return proposal;
}

async function auditOrApply(apply) {
  const runId = randomUUID();
  const leads = await prisma.lead.findMany({
    where: { OR: [
      { utmSource: null }, { utmMedium: null }, { utmCampaign: null },
      { firstTouchSource: null }, { lastTouchSource: null },
    ] },
    select: {
      id: true, utmSource: true, utmMedium: true, utmCampaign: true,
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

  const candidates = [];
  for (const lead of leads) {
    const touches = [
      ...lead.scorecardSubmissions.map((s) => ({ occurredAt: s.submittedAt, channel: 'SCORECARD', ...s })),
      ...lead.webinarRegistrations.map((w) => ({ occurredAt: w.createdAt, channel: 'WEBSITE_WEBINAR', ...w })),
    ];
    const oldValue = {
      utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
      firstTouchSource: lead.firstTouchSource, lastTouchSource: lead.lastTouchSource,
    };
    const proposal = plan(oldValue, touches);
    if (Object.keys(proposal).length) candidates.push({ leadId: lead.id, oldValue, proposal });
  }

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN', runId, scannedLeads: leads.length,
    candidateLeads: candidates.length, sample: candidates.slice(0, 10),
  }, null, 2));
  if (!apply) return;

  let applied = 0;
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.lead.findUnique({ where: { id: candidate.leadId }, select: {
        utmSource: true, utmMedium: true, utmCampaign: true,
        firstTouchSource: true, lastTouchSource: true,
      } });
      if (!current) return;
      const safeProposal = Object.fromEntries(
        Object.entries(candidate.proposal).filter(([key]) => current[key] == null),
      );
      if (!Object.keys(safeProposal).length) return;
      await tx.lead.update({ where: { id: candidate.leadId }, data: safeProposal });
      await tx.auditLog.create({ data: {
        action: 'UPDATE', eventType: 'LEAD_ATTRIBUTION_BACKFILLED', entityType: 'LEAD', entityId: candidate.leadId,
        oldValue: current, newValue: { runId, proposal: safeProposal },
        actorNameSnapshot: 'backfill-lead-attribution', actorRoleSnapshot: 'SYSTEM',
      } });
      applied++;
    });
  }
  console.log(JSON.stringify({ status: 'BACKFILL_SUCCESS', runId, applied }));
}

async function rollback(runId) {
  const audits = await prisma.auditLog.findMany({
    where: { eventType: 'LEAD_ATTRIBUTION_BACKFILLED', entityType: 'LEAD' },
    orderBy: { createdAt: 'desc' },
  });
  const matching = audits.filter((a) => a.newValue?.runId === runId);
  let restored = 0;
  for (const audit of matching) {
    if (!audit.entityId || !audit.oldValue) continue;
    const proposal = audit.newValue?.proposal || {};
    const current = await prisma.lead.findUnique({ where: { id: audit.entityId }, select: {
      utmSource: true, utmMedium: true, utmCampaign: true, firstTouchSource: true, lastTouchSource: true,
    } });
    if (!current) continue;
    if (!Object.entries(proposal).every(([key, value]) => current[key] === value)) {
      console.warn(`[skip] ${audit.entityId}: attribution changed after backfill; manual review required`);
      continue;
    }
    const restore = Object.fromEntries(Object.keys(proposal).map((key) => [key, audit.oldValue[key]]));
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: audit.entityId }, data: restore });
      await tx.auditLog.create({ data: {
        action: 'UPDATE', eventType: 'LEAD_ATTRIBUTION_BACKFILL_ROLLED_BACK', entityType: 'LEAD', entityId: audit.entityId,
        oldValue: current, newValue: { runId, restoredFromAuditId: audit.id, restore },
        actorNameSnapshot: 'backfill-lead-attribution', actorRoleSnapshot: 'SYSTEM',
      } });
    });
    restored++;
  }
  console.log(JSON.stringify({ status: 'ROLLBACK_COMPLETE', runId, eligible: matching.length, restored }));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rollbackArg = process.argv.find((arg) => arg.startsWith('--rollback='));
  if (apply && rollbackArg) throw new Error('Choose either --apply or --rollback, not both.');
  if (apply && !process.argv.includes(APPLY_CONFIRMATION)) throw new Error(`Apply requires ${APPLY_CONFIRMATION}`);
  if (rollbackArg && !process.argv.includes(ROLLBACK_CONFIRMATION)) throw new Error(`Rollback requires ${ROLLBACK_CONFIRMATION}`);
  if (rollbackArg) return rollback(rollbackArg.slice('--rollback='.length));
  return auditOrApply(apply);
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
