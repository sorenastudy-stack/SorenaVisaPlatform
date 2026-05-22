// PR-WIX-1 — Wix lead-capture DTO marker.
//
// Wix's payload envelope isn't standardised, so we don't apply
// class-validator at the request boundary — the controller takes
// the raw body and hands it to `normaliseWixPayload`. This file
// exists so the controller can name its body parameter
// consistently with the rest of the codebase and so future PRs
// have a place to drop request-shape contract tests.

export type WixLeadCaptureBody = Record<string, unknown>;
