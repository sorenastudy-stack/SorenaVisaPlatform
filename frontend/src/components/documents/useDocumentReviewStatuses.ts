'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Item 1 — student-facing document review status.
//
// Fetches GET /students/me/documents/review-status once and exposes a
// (source, sourceRowId) lookup so any doc-row renderer can attach a badge.
// The endpoint is owner-scoped server-side; the reason is present ONLY on
// REJECTED rows (server-gated) and reviewer identity is never returned.

export type DocReviewStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
export type DocReviewSource = 'ADMISSION' | 'VISA_SUPPORTING';

export interface DocReviewRow {
  source: DocReviewSource;
  sourceRowId: string;
  docType: string;
  status: DocReviewStatus;
  reviewedAt: string | null;
  reason: string | null;
}

// Module-level in-flight cache so the many uploader instances rendered across
// the admission + visa forms share a single request. Refreshes on a full page
// load (the form shells are client SPAs, so a badge may lag a fresh verdict
// until reload — acceptable for a read-only status hint).
let cache: Promise<DocReviewRow[]> | null = null;

function load(): Promise<DocReviewRow[]> {
  if (!cache) {
    cache = api
      .get<DocReviewRow[]>('/students/me/documents/review-status')
      .catch(() => [] as DocReviewRow[]);
  }
  return cache;
}

export function useDocumentReviewStatuses() {
  const [rows, setRows] = useState<DocReviewRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    load().then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, []);

  const statusFor = (source: DocReviewSource, sourceRowId: string): DocReviewRow | null =>
    rows?.find((r) => r.source === source && r.sourceRowId === sourceRowId) ?? null;

  return { loading: rows === null, statusFor };
}
