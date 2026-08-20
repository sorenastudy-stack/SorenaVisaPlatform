// PR-WEBINAR-1 — Webinar registration payload normaliser.
//
// Same rationale as `webhooks/wix/wix-payload-normaliser.ts`: the caller is an
// external system, so this walks the JSON tree and pulls out the fields we care
// about by fuzzy name match. If the website's payload gains a differently-named
// field, add the observed key to the relevant SYNONYMS list — no controller or
// service change needed.
//
// UNLIKE the Wix normaliser, this one is written against a payload we have
// actually read rather than guessed at. The live site
// (app/webinars/study-in-new-zealand/WebinarRegistration.tsx, forwarded by
// app/api/webinar-registration/route.ts) sends exactly:
//
//   firstName, lastName, email, country, preferredLanguage, phone, question,
//   privacyConsent:"yes", marketingConsent:"yes"|absent, website:"" (honeypot),
//   eventSlug:"study-in-new-zealand-weekly", pageUrl, timezone,
//   utm_source/utm_medium/utm_campaign/utm_content/utm_term/ref (when present),
//   receivedAt, source:"sorenavisa-website"
//
// Two consequences of that real shape are handled explicitly below, because a
// naive synonym match gets both WRONG while still returning 200:
//
//   1. There is NO `fullName` field — the form collects first and last name
//      separately. Matching `firstname` alone would store "Ali" for a person
//      called "Ali Rezaei", losing the surname on every single registration.
//      So the composed first+last name wins over any single-part match.
//   2. Consent arrives as the STRING "yes" (an HTML checkbox `value="yes"`),
//      not a boolean or "true". A boolean-only parse records marketing consent
//      as null — losing a consent decision we are obliged to record.

const SYNONYMS: Record<string, string[]> = {
  webinarSlug: [
    'eventslug', 'webinarslug', 'slug', 'webinarid', 'webinar', 'eventid',
  ],
  // Only consulted when first/last name are absent — see composeName().
  fullName: [
    'fullname', 'name', 'firstandlastname', 'studentname',
  ],
  firstName: ['firstname', 'givenname', 'forename'],
  lastName: ['lastname', 'surname', 'familyname'],
  email: [
    'email', 'emailaddress', 'emailaddr', 'contactemail', 'studentemail',
  ],
  phone: [
    'phone', 'phonenumber', 'mobile', 'mobilenumber', 'contactphone',
    'studentphone', 'tel', 'telephone', 'whatsapp',
  ],
  countryOfResidence: [
    'country', 'countryofresidence', 'countrycode', 'residencecountry',
    'currentcountry', 'location',
  ],
  intendedStudyLevel: [
    'intendedstudylevel', 'studylevel', 'level', 'educationlevel',
  ],
  intake: [
    'intake', 'intendedintake', 'startdate', 'targetintake',
  ],
  preferredLanguage: [
    'preferredlanguage', 'language', 'lang',
  ],
  marketingConsent: [
    'marketingconsent', 'marketingoptin', 'newsletteroptin',
  ],
  operationalConsent: [
    'privacyconsent', 'operationalconsent', 'consent', 'termsconsent',
  ],
};

function fuzzy(key: string): string {
  return key.toLowerCase().replace(/[\s_\-.]+/g, '');
}

function flatten(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visited = new Set<unknown>();

  function walk(node: unknown) {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (v === null || typeof v !== 'object') {
        const key = fuzzy(k);
        if (key) out[key] = v;
      }
      walk(v);
    }
  }

  walk(input);
  return out;
}

function pickString(flat: Record<string, unknown>, synonyms: string[]): string | null {
  for (const s of synonyms) {
    const v = flat[s];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Consent as a person actually submits it.
 *
 * An HTML checkbox posts its `value` attribute — the live form uses "yes" — so
 * a boolean-only parse silently drops the answer. Anything not recognised as an
 * affirmative or a negative returns null ("not stated"), never a guessed false:
 * "we have no record" and "they declined" are different facts.
 */
function pickConsent(flat: Record<string, unknown>, synonyms: string[]): boolean | null {
  const YES = new Set(['yes', 'true', 'on', '1', 'y', 'checked']);
  const NO = new Set(['no', 'false', 'off', '0', 'n', '']);
  for (const s of synonyms) {
    const v = flat[s];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (YES.has(t)) return true;
      if (NO.has(t)) return false;
    }
  }
  return null;
}

/**
 * The registrant's name, preferring the parts over any single-field guess.
 *
 * The live form has no `fullName` at all, so first+last is the normal path and
 * `fullName` is the fallback — the opposite priority to what a synonym list
 * would naturally express.
 */
function composeName(flat: Record<string, unknown>): string | null {
  const first = pickString(flat, SYNONYMS.firstName);
  const last = pickString(flat, SYNONYMS.lastName);
  const joined = [first, last].filter(Boolean).join(' ').trim();
  if (joined.length > 0) return joined;
  return pickString(flat, SYNONYMS.fullName);
}

export interface NormalisedWebinarRegistration {
  webinarSlug:        string | null;
  fullName:           string | null;
  email:              string | null;
  phone:              string | null;
  countryOfResidence: string | null;
  intendedStudyLevel: string | null;
  intake:             string | null;
  preferredLanguage:  string | null;
  marketingConsent:   boolean | null;
  operationalConsent: boolean | null;
  rawPayloadKeys:     string[];
}

export function normaliseWebinarPayload(body: unknown): NormalisedWebinarRegistration {
  const flat = flatten(body);
  const rawPayloadKeys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body as Record<string, unknown>)
    : [];

  return {
    webinarSlug:        pickString(flat, SYNONYMS.webinarSlug),
    fullName:           composeName(flat),
    email:              pickString(flat, SYNONYMS.email),
    phone:              pickString(flat, SYNONYMS.phone),
    countryOfResidence: pickString(flat, SYNONYMS.countryOfResidence),
    intendedStudyLevel: pickString(flat, SYNONYMS.intendedStudyLevel),
    intake:             pickString(flat, SYNONYMS.intake),
    preferredLanguage:  pickString(flat, SYNONYMS.preferredLanguage),
    marketingConsent:   pickConsent(flat, SYNONYMS.marketingConsent),
    operationalConsent: pickConsent(flat, SYNONYMS.operationalConsent),
    rawPayloadKeys,
  };
}

// Reused for the UTM/landing-page envelope fields, same pattern as the Wix
// normaliser's `pickEnvelopeString`.
export function pickEnvelopeString(body: unknown, candidates: string[]): string | null {
  const flat = flatten(body);
  return pickString(flat, candidates.map(fuzzy));
}
