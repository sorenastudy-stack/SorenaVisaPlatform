import { Prisma } from '@prisma/client';
import * as countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

// PR-CLIENT-ID — permanent, human-readable Lead identifier.
//
//   Format:  {COUNTRY}-{YEAR}-{NNNNNN}     e.g.  NZ-2026-000001
//   COUNTRY: 2-letter code from the lead's selected country.
//   YEAR:    4-digit creation year.
//   NUMBER:  6-digit, zero-padded, a SINGLE GLOBAL counter per year (shared
//            across every country) that resets to 1 on 1 January.
//
// The number comes from an ATOMIC per-year counter row — never COUNT(*)+1 — so
// concurrent lead creation can't collide. This module is dependency-free so the
// runtime paths and the backfill share the exact same logic.

countries.registerLocale(enLocale as any);

// Any client that can run the counter query + contact lookup — the full
// PrismaClient or an interactive-transaction client (both expose $queryRaw and
// the model delegates).
type Db = Prisma.TransactionClient;

// Fallback prefix when a lead has no resolvable country. "TEST" (not a real
// country code) makes it obvious at a glance that these are test/debug leads.
// The code is NOT assumed to be 2 chars anywhere — clientId is always parsed by
// the '-' delimiter, never by fixed width.
const UNKNOWN_COUNTRY = 'TEST';

// A free-text country name → ISO alpha-2 (uppercase), or null if unmappable.
// "United Kingdom" → GB is remapped to the commonly-used "UK" per spec.
function nameToAlpha2(name?: string | null): string | null {
  if (!name || !name.trim()) return null;
  const code = countries.getAlpha2Code(name.trim(), 'en');
  if (!code) return null;
  return code === 'GB' ? 'UK' : code.toUpperCase();
}

// The platform's study-destination enum → alpha-2.
function targetToAlpha2(target?: string | null): string | null {
  if (target === 'NEW_ZEALAND') return 'NZ';
  if (target === 'MALAYSIA') return 'MY';
  return null;
}

export interface CountrySource {
  countryOfResidence?: string | null; // Contact.countryOfResidence (free-text name)
  targetCountry?: string | null;      // Lead.targetCountry enum
  countryRaw?: string | null;         // Lead.countryRaw (Wix un-resolved name)
}

// Resolve the 2-letter country code from the available signals, in priority
// order. Returns null when nothing resolves (caller may then try a contact
// lookup before falling back to the TEST prefix).
export function resolveCountryCode(src: CountrySource): string | null {
  return (
    nameToAlpha2(src.countryOfResidence) ??
    targetToAlpha2(src.targetCountry) ??
    nameToAlpha2(src.countryRaw)
  );
}

// Zero-pad the number to 6 digits (000001). Numbers > 999999 are not padded/
// truncated — they simply render at full width (defensive; a year would need a
// million leads to reach it).
export function formatClientId(code: string, year: number, n: number): string {
  return `${code}-${year}-${String(n).padStart(6, '0')}`;
}

// ATOMIC next number for a given year. `INSERT ... ON CONFLICT DO UPDATE ...
// RETURNING` locks the counter row for the duration of the statement, so two
// concurrent callers serialize and get distinct values. A brand-new year's
// first call inserts lastNumber = 1 (the year-reset); every later call
// increments. Runs on whatever client is passed — pass a tx client to make it
// atomic with the lead insert (rolled back together, so no gaps on failure).
export async function nextClientNumber(db: Db, year: number): Promise<number> {
  const rows = await db.$queryRaw<Array<{ lastNumber: number }>>(Prisma.sql`
    INSERT INTO "client_id_counters" ("year", "lastNumber")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastNumber" = "client_id_counters"."lastNumber" + 1
    RETURNING "lastNumber"
  `);
  return Number(rows[0].lastNumber);
}

export interface GenerateOpts extends CountrySource {
  contactId?: string;  // fallback country source, looked up on `db`
  at?: Date;           // creation timestamp (defaults to now)
}

// Generate the full clientId for a new lead. Resolves the country (provided
// signals first, then the contact's countryOfResidence — visible inside the
// same transaction), then takes the next atomic number for the year.
export async function generateClientId(db: Db, opts: GenerateOpts = {}): Promise<string> {
  const at = opts.at ?? new Date();
  const year = at.getFullYear();

  let code = resolveCountryCode(opts);
  if (!code && opts.contactId) {
    const contact = await db.contact.findUnique({
      where: { id: opts.contactId },
      select: { countryOfResidence: true },
    });
    code = nameToAlpha2(contact?.countryOfResidence);
  }
  code = code ?? UNKNOWN_COUNTRY;

  const n = await nextClientNumber(db, year);
  return formatClientId(code, year, n);
}
