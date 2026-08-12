// PR-AGENT-PORTAL phase 0 — is this adviser's licence current?
//
// A verified licence is not a permanent fact. Verification records that
// somebody checked the IAA register on a particular day; the licence itself
// runs out. Without an expiry the platform would keep treating a lapsed
// adviser as current, which is the one thing licence verification exists to
// prevent.
//
// TWO MECHANISMS, DELIBERATELY:
//
//   the DATE, checked here, at the moment of a gated action — the boundary.
//   the FLAG (LiaProfile.isLicenceExpired), set by the daily sweep — for
//   listing who has lapsed, cheaply, without date arithmetic across the table.
//
// The flag alone would be unsafe: a licence expiring at midnight would stay
// usable until the sweep next ran, and a cron that silently stopped would
// leave everybody permanently valid — a failure that looks like nothing
// happening. The date alone would work but makes "who is about to lapse"
// a scan. So: flag for the queue, date for the decision.

export interface LicenceWindow {
  licenceExpiryDate?: Date | null;
  iaaLicenceVerifiedAt?: Date | null;
}

/**
 * Has the licence run out?
 *
 * A NULL expiry is NOT expired. Every row predates this field, and treating
 * "we never recorded a date" as "expired" would lock out the advisers already
 * working — a data gap must not read as a licence failure. The Owner supplies
 * dates as part of onboarding; until then nothing changes for anyone.
 *
 * The comparison is by whole day: a licence is valid THROUGH its expiry date,
 * which is how a licence is read on paper, and how the adviser will read it.
 */
export function isLicenceExpired(profile: LicenceWindow | null | undefined, now = new Date()): boolean {
  const expiry = profile?.licenceExpiryDate;
  if (!expiry) return false;
  const end = new Date(expiry);
  end.setHours(23, 59, 59, 999);
  return now.getTime() > end.getTime();
}

/**
 * May this adviser act — i.e. is the licence both verified and unexpired?
 *
 * Kept separate from `isLicenceExpired` because the two answer different
 * questions and later phases need both: a queue asks "has it lapsed", a gate
 * asks "may they work".
 */
export function isLicenceCurrent(profile: LicenceWindow | null | undefined, now = new Date()): boolean {
  if (!profile?.iaaLicenceVerifiedAt) return false;
  return !isLicenceExpired(profile, now);
}

/** Days until expiry — negative once past. Null when no date is recorded. */
export function daysUntilExpiry(profile: LicenceWindow | null | undefined, now = new Date()): number | null {
  const expiry = profile?.licenceExpiryDate;
  if (!expiry) return null;
  const end = new Date(expiry);
  end.setHours(23, 59, 59, 999);
  return Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) - 1;
}
