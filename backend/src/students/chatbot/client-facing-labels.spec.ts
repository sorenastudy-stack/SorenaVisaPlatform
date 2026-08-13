import { VisaCaseStatus, VisaMeetingStatus } from '@prisma/client';
import {
  CASE_STAGE_LABEL, MEETING_STATUS_LABEL, caseStageLabel, meetingStatusLabel,
} from './client-facing-labels';

// PR-PORTAL-EMPTY-STATES — the assistant must not be able to emit ANY raw
// status enum, not merely the one that was reported.
//
// The bug was "your case is currently in **DRAFT** stage". Fixing DRAFT alone
// would leave six other values one question away from the same leak, so these
// tests iterate the enums rather than naming a case.

const CASE_STATUSES = Object.values(VisaCaseStatus);
const MEETING_STATUSES = Object.values(VisaMeetingStatus);

describe('no raw status enum can reach the assistant', () => {
  it('every VisaCaseStatus has client-facing wording', () => {
    expect(CASE_STATUSES.length).toBeGreaterThan(0);
    for (const s of CASE_STATUSES) {
      expect(CASE_STAGE_LABEL[s]).toBeTruthy();
    }
  });

  it.each(CASE_STATUSES)('%s never renders as itself', (status) => {
    const label = caseStageLabel(status);
    expect(label).toBeTruthy();
    // The leak was the enum TOKEN — "**DRAFT**" — not the concept. Plain
    // English legitimately coincides with some enum names ("approved"), and
    // that is the right word for a client to read. What must never appear is
    // the machine form: SCREAMING_CASE or an underscore.
    expect(label).not.toBe(status);
    expect(label).not.toMatch(/^[A-Z][A-Z_]+$/);
    expect(label).not.toContain('_');
  });

  it.each(MEETING_STATUSES)('meeting status %s never renders as itself', (status) => {
    const label = meetingStatusLabel(status);
    expect(label).toBeTruthy();
    expect(label).not.toBe(status);
    expect(label).not.toMatch(/^[A-Z][A-Z_]+$/);
    expect(label).not.toContain('_');
  });

  it('every VisaMeetingStatus has client-facing wording', () => {
    for (const s of MEETING_STATUSES) expect(MEETING_STATUS_LABEL[s]).toBeTruthy();
  });

  it('a status the map has never heard of still does not leak', () => {
    // Belt to the exhaustive Record's braces: if a value reaches here without
    // being routed through the map, the client gets a neutral phrase, not a
    // column value.
    expect(caseStageLabel('SOME_NEW_STATUS' as VisaCaseStatus)).toBe('in progress');
    expect(meetingStatusLabel('SOME_NEW_STATUS')).toBe('other');
  });

  it('no case is left null-ish, and no case is present', () => {
    expect(caseStageLabel(null)).toBeNull();
    expect(caseStageLabel(undefined)).toBeNull();
  });

  it('the wording reads like the portal, not like a database', () => {
    // A cheap shape check: client copy is lower-case prose, never SCREAMING_CASE.
    for (const label of Object.values(CASE_STAGE_LABEL)) {
      expect(label).not.toMatch(/^[A-Z_]+$/);
      expect(label).not.toMatch(/_/);
    }
  });
});
