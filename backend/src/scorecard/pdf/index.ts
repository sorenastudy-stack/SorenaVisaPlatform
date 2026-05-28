// PR-SCORECARD-3 — Barrel export for the PDF renderer layer.
//
// External callers (scorecard.service.ts) import from here so the
// helpers + per-report files can move around freely.

export { renderInternalReport } from './internal-report';
export type { InternalReportData } from './internal-report';
export { renderClientReport } from './client-report';
export type { ClientReportData } from './client-report';
export { BRAND, bandColor } from './branding';
export { shortFilenameSlug } from './helpers';
