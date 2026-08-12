import { PrismaService } from '../prisma/prisma.service';

// PR-AGENT-PORTAL phase 1 — what an agent is allowed to do, decided once.
//
// An agent may see nothing in the portal until BOTH halves are true:
//
//   VERIFIED   — the Owner reviewed their identity and business documents
//   CONTRACTED — they are under contract (signed in phase 3, or cleared by an
//                Owner override until that exists)
//
// The two are separate obligations that fail for different reasons, so they are
// reported separately and the agent is told which one is outstanding.
//
// This lives in ONE function because the guard and the status endpoint both
// need the answer, and a gate written out twice is how one copy ends up right
// and the other wrong — which happened yesterday with the licence expiry
// boundary, in this same feature.

export type AgentBlockedReason = 'NO_AGENT_RECORD' | 'NOT_VERIFIED' | 'NO_CONTRACT' | 'AGENT_INACTIVE';

export interface AgentAccess {
  /** The AffiliateAgent this login belongs to, if any. */
  agentId: string | null;
  agentName: string | null;
  /** Identity + business documents accepted by the Owner. */
  verified: boolean;
  /** Under contract — however that came about. */
  contracted: boolean;
  /** TRUE when the contract half was cleared by a human, not signed. */
  contractIsManualOverride: boolean;
  /** The only field a caller should branch on. */
  allowed: boolean;
  /** What is outstanding, for a screen that explains itself. */
  blockedReasons: AgentBlockedReason[];
}

const DENIED = (reason: AgentBlockedReason): AgentAccess => ({
  agentId: null,
  agentName: null,
  verified: false,
  contracted: false,
  contractIsManualOverride: false,
  allowed: false,
  blockedReasons: [reason],
});

/**
 * Resolve what this login may do.
 *
 * FAILS CLOSED. No user id, no agent record, a paused or terminated agent, or
 * anything unexpected produces `allowed: false`. Nothing here throws, because
 * both callers need a state rather than an exception: the guard turns it into
 * a 403, the status endpoint renders it.
 *
 * The agent is resolved from the JWT's user id ONLY — never from anything the
 * caller supplies. That is what makes "their own data" mean something.
 */
export async function resolveAgentAccess(
  prisma: PrismaService,
  userId: string | null | undefined,
): Promise<AgentAccess> {
  if (!userId) return DENIED('NO_AGENT_RECORD');

  const agent = await prisma.affiliateAgent.findUnique({
    where: { userId },
    select: {
      id: true,
      fullName: true,
      status: true,
      verifiedAt: true,
      contractSignedAt: true,
      contractIsManualOverride: true,
    },
  });
  if (!agent) return DENIED('NO_AGENT_RECORD');

  const blockedReasons: AgentBlockedReason[] = [];

  // A paused or terminated agent keeps their record and their money, and loses
  // the portal. Checked first because it overrides everything else: an agent
  // who was verified and contracted before being paused is still paused.
  if (agent.status !== 'ACTIVE') blockedReasons.push('AGENT_INACTIVE');

  const verified = !!agent.verifiedAt;
  const contracted = !!agent.contractSignedAt;
  if (!verified) blockedReasons.push('NOT_VERIFIED');
  if (!contracted) blockedReasons.push('NO_CONTRACT');

  return {
    agentId: agent.id,
    agentName: agent.fullName,
    verified,
    contracted,
    contractIsManualOverride: agent.contractIsManualOverride,
    allowed: blockedReasons.length === 0,
    blockedReasons,
  };
}
