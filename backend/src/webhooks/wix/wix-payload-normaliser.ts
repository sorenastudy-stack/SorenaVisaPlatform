// PR-WIX-1 — Wix payload normaliser.
//
// Wix's actual form-submission shape isn't standardised — the
// platform sends different envelopes depending on whether the form
// is Wix Forms, an automation step, an HTTP-function call, or a
// custom code block. We deliberately don't lock the controller to
// one shape; instead this normaliser walks any reasonable JSON tree
// and pulls out the five fields we care about.
//
// Strategy:
//   1. Flatten the inbound object into a `{ "fuzzykey": value }`
//      map. "fuzzykey" is the leaf field name lowercased with
//      whitespace, underscores, dashes, and dots stripped.
//   2. For each canonical field (fullName, email, phone, country,
//      educationLevel) try a small list of synonyms in priority
//      order — the first match wins. The canonical key wins over
//      every synonym so an explicit `fullName` always beats a
//      stray `name` field elsewhere in the tree.
//   3. Strings are trimmed; non-string scalars stringify; objects
//      and arrays are ignored (they're either envelopes the
//      walker has already descended into, or junk we can't use).

// Match groups per canonical field, in priority order.
// Lower-cased + whitespace/punct-stripped (see `fuzzy()` below).
const SYNONYMS: Record<string, string[]> = {
  fullName: [
    'fullname', 'name', 'fullnamelabel',
    'firstandlastname', 'firstname', 'givenname',
    'studentname',
  ],
  email: [
    'email', 'emailaddress', 'emailaddr',
    'contactemail', 'studentemail',
  ],
  phone: [
    'phone', 'phonenumber', 'mobile', 'mobilenumber',
    'contactphone', 'studentphone', 'tel', 'telephone',
  ],
  countryOfResidence: [
    'countryofresidence', 'country', 'countrycode',
    'residencecountry', 'currentcountry', 'location',
  ],
  currentEducationLevel: [
    'currenteducationlevel', 'educationlevel',
    'highesteducation', 'highesteducationallevel',
    'qualification', 'highestqualification',
    'education', 'level',
  ],
};

// Strip whitespace, dashes, underscores, dots; lowercase. Designed
// so "Full Name", "full_name", "full-name", "fullName", "FULL.NAME"
// all collapse to "fullname".
function fuzzy(key: string): string {
  return key.toLowerCase().replace(/[\s_\-.]+/g, '');
}

// Walk an object tree depth-first, collecting every leaf value
// keyed by its fuzzy field name. Later occurrences overwrite
// earlier ones — Wix Forms-style payloads have field ids in the
// envelope but human-readable labels nested deeper, so taking the
// last match by-key tends to win the right value. Cycles are
// guarded by a visited-set (Wix shouldn't send cyclic JSON but
// `JSON.parse` won't produce one anyway).
function flatten(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visited = new Set<unknown>();

  function walk(node: unknown) {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      // Arrays of `{ name, value }` pairs are a common Wix-forms
      // shape — surface them as `{ <name>: <value> }` first, then
      // fall through to the generic walk.
      for (const item of node) {
        if (item && typeof item === 'object'
            && 'name' in item && 'value' in item
            && typeof (item as { name: unknown }).name === 'string') {
          const key = fuzzy(String((item as { name: string }).name));
          if (key) out[key] = (item as { value: unknown }).value;
        }
        walk(item);
      }
      return;
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // Leaf scalar (or array) → record it under the fuzzy key.
      // The descent below also picks it up if it's an object — we
      // want both the parent label AND the deeper label.
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
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim();
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return String(v);
    }
  }
  return null;
}

export interface NormalisedLead {
  fullName:              string | null;
  email:                 string | null;
  phone:                 string | null;
  countryOfResidence:    string | null;
  currentEducationLevel: string | null;
  // Original payload top-level keys, used as audit metadata so we
  // can diagnose unfamiliar Wix shapes after the fact without
  // re-tracing the production logs.
  rawPayloadKeys:        string[];
}

export function normaliseWixPayload(body: unknown): NormalisedLead {
  const flat = flatten(body);
  const rawPayloadKeys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body as Record<string, unknown>)
    : [];

  return {
    fullName:              pickString(flat, SYNONYMS.fullName),
    email:                 pickString(flat, SYNONYMS.email),
    phone:                 pickString(flat, SYNONYMS.phone),
    countryOfResidence:    pickString(flat, SYNONYMS.countryOfResidence),
    currentEducationLevel: pickString(flat, SYNONYMS.currentEducationLevel),
    rawPayloadKeys,
  };
}

// Useful enough on its own that the controller may want to surface
// it for the `submittedAt` / `submissionId` envelope fields too.
export function pickEnvelopeString(body: unknown, candidates: string[]): string | null {
  const flat = flatten(body);
  return pickString(flat, candidates.map(fuzzy));
}
