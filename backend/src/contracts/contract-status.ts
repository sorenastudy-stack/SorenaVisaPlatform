import { ContractStatus } from '@prisma/client';

// PR-LIA-AUTO-ASSIGN, Phase 5 — DocuSign-status → ContractStatus mapper.
//
// DocuSign's envelope status field returns lowercase strings ("sent",
// "completed", "voided", ...). Before this PR, `handleWebhook` wrote those
// raw strings into the `contracts.status` column whose Prisma type is the
// uppercase enum (DRAFT | SENT | VIEWED | SIGNED | DECLINED | EXPIRED) —
// a silent enum/string mismatch that has never been exercised in prod
// because no contract has ever been signed for any case in the DB.
//
// The mapping table below is the single source of truth from this point
// on. The webhook calls this mapper, refuses to persist when it can't
// map (logs the unknown DocuSign value), and stores the uppercase enum
// going forward. Any other read site that needs to ask "is this signed?"
// should compare against `ContractStatus.SIGNED`, not the raw string.
//
// Defensive note: the parallel ACCOUNT_OPENING auto-assign trigger in
// payments.controller checks `Contract.signedAt IS NOT NULL` instead of
// keying off `status` — that survives both this mapping and any future
// DocuSign relabel.
const DOCUSIGN_STATUS_MAP: Record<string, ContractStatus> = {
  created:   'DRAFT',
  sent:      'SENT',
  delivered: 'VIEWED',
  completed: 'SIGNED',
  declined:  'DECLINED',
  voided:    'EXPIRED',
};

/**
 * Map a raw DocuSign envelope-status string to the Prisma `ContractStatus`
 * enum value. Returns `null` when the input doesn't match any known
 * DocuSign status — callers should treat that as "skip / log warning",
 * not "write null to the column".
 *
 * Case-insensitive on the DocuSign side; non-string inputs return null.
 */
export function docusignToContractStatus(
  s: string | null | undefined,
): ContractStatus | null {
  if (typeof s !== 'string') return null;
  return DOCUSIGN_STATUS_MAP[s.toLowerCase()] ?? null;
}
