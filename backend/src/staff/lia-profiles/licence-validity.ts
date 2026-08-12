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
 * Today, as a whole date, for comparing against a DATE column.
 *
 * Built from LOCAL calendar parts and pinned to UTC midnight, and it must be
 * used by EVERY query that compares licenceExpiryDate. Two separate traps make
 * the obvious version wrong, and both fail silently:
 *
 *   licenceExpiryDate is a DATE column, so Postgres casts whatever it is
 *   compared against down to a date — in UTC. Passing a raw `new Date()` from
 *   New Zealand therefore compares against YESTERDAY's date for the first
 *   twelve hours of every local day, and a licence that lapsed yesterday reads
 *   as still valid all morning.
 *
 *   Building it from UTC parts instead of local ones shifts the boundary the
 *   other way, for the other half of the day.
 *
 * This was not caught by tests or by reading the code. It was caught by running
 * the same check at 08:40 the next morning, when the UTC date had not yet
 * caught up — the identical query had passed at 23:50 the night before. Which
 * is the argument for one shared helper rather than the same expression
 * written out at each call site.
 */
export function todayAsDateBoundary(now = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * The Prisma `where` fragment for "this licence has not lapsed".
 *
 * Exported as a fragment so every gate asks the question the same way. A
 * NULL expiry passes: every row predates the field, and a data gap must not
 * read as a licence failure.
 */
export function notExpiredFilter(now = new Date()) {
  const today = todayAsDateBoundary(now);
  return {
    isLicenceExpired: false,
    OR: [{ licenceExpiryDate: null }, { licenceExpiryDate: { gte: today } }],
  };
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
