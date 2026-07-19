import sanitizeHtml from 'sanitize-html';

// PR-LIA-CONVO-NOTES — server-side rich-text sanitizer (shared).
//
// This is the ONLY place client-supplied HTML is allowed to enter the database.
// It is deliberately an ALLOWLIST: everything not named below is stripped. A
// blocklist ("remove <script>") is unsafe — it always loses to the next vector
// (<img onerror>, javascript: URLs, SVG, CSS expressions). We permit exactly the
// tags the shared RichTextEditor can produce (bold / italic / underline / lists
// / links) and nothing else.
//
// First consumer: LIA conversation notes. Built to be reused verbatim for the
// ticket editor next — keep it feature-agnostic.

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  // Formatting + lists + links only. No block containers beyond <p>, no images,
  // no tables, no headings, no styles/classes/ids.
  allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: {
    // href + the two attributes transformTags hardens every link with. No style,
    // no class, no on* handlers (those are never in the allowlist so they are
    // dropped regardless). target/rel must be listed here or the allowlist filter
    // — which runs AFTER transformTags — would strip the hardening back off.
    // Their VALUES are still forced by transformTags, so a caller can't set them.
    a: ['href', 'target', 'rel'],
  },
  // Links may only point somewhere safe. Note: javascript:, data:, vbscript:,
  // and file: are all EXCLUDED, so a `javascript:alert(1)` href is stripped.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Never permit protocol-relative or scheme-less javascript smuggling.
  allowProtocolRelative: false,
  // Every surviving <a> is hardened: force it to open in a new tab and cut the
  // opener reference so a linked page cannot reach back into window.opener.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
  // Drop the contents of anything script-like outright (belt-and-braces; these
  // tags aren't in allowedTags anyway).
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed'],
};

/**
 * Sanitize client-supplied rich-text HTML down to the shared allowlist.
 * Returns HTML that is safe to store and later render with dangerouslySetInnerHTML.
 * NEVER trust the input — this runs server-side on every write.
 */
export function sanitizeRichText(dirty: string): string {
  if (!dirty) return '';
  return sanitizeHtml(dirty, RICH_TEXT_OPTIONS).trim();
}

/**
 * True when, after sanitizing, the note carries no actual content (only empty
 * tags / whitespace). Used to reject "blank" notes and notes whose entire body
 * was a stripped XSS payload.
 */
export function isEffectivelyEmpty(cleanHtml: string): boolean {
  // Remove every tag and non-breaking space, then look for a real character.
  const textOnly = cleanHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return textOnly.length === 0;
}
