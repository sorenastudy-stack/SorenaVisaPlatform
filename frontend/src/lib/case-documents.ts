import { api } from './api';

// Phase 6.5 — shared helpers for the Phase 5 case-document flow.
//
// CaseDocumentsPanel keeps its own inline copy of this logic (it's the
// original implementation, shared with the client portal, and has its
// own tests). To avoid changing that shared component just to satisfy a
// payments-side use case, the helpers below extract the SAME 3-step
// upload + presigned-GET-view pattern into pure functions so any other
// surface (the receipt upload in the staff Payments tab, future
// attachment flows) can reuse it without duplicating bytes-to-R2 code.
//
// If/when CaseDocumentsPanel is touched again, it should switch to
// these helpers too — but that's a follow-up refactor, not Phase 6.5.

export const CASE_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const CASE_DOCUMENT_MAX_BYTES  = 15 * 1024 * 1024; // 15 MiB — matches backend DTO

interface RequestUploadResponse {
  documentId:       string;
  uploadUrl:        string;
  r2Key:            string;
  expiresInSeconds: number;
}

interface DownloadUrlResponse {
  url:              string;
  expiresInSeconds: number;
}

export function isCaseDocumentMimeTypeAllowed(mimeType: string): boolean {
  return (CASE_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isCaseDocumentSizeAllowed(sizeBytes: number): boolean {
  return sizeBytes <= CASE_DOCUMENT_MAX_BYTES;
}

/**
 * 3-step Phase 5 case-document upload:
 *   1. request-upload  → presigned PUT URL + documentId
 *   2. raw PUT to R2   (NOT via the api helper — Cloudflare expects raw
 *                       bytes + the file's own Content-Type only, no JWT)
 *   3. confirm         → flips the DB row PENDING → UPLOADED + audit row
 *
 * Returns the confirmed document id. Errors propagate to the caller so
 * each surface (Documents panel, Payments receipt) can render its own
 * inline error UI.
 */
export async function uploadCaseDocument(
  caseId: string,
  file: File,
): Promise<string> {
  const req = await api.post<RequestUploadResponse>(
    `/cases/${caseId}/documents/request-upload`,
    {
      originalName: file.name,
      mimeType:     file.type,
      sizeBytes:    file.size,
    },
  );

  const putRes = await fetch(req.uploadUrl, {
    method:  'PUT',
    body:    file,
    headers: { 'Content-Type': file.type },
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (HTTP ${putRes.status}).`);
  }

  await api.post(`/cases/${caseId}/documents/${req.documentId}/confirm`, {});
  return req.documentId;
}

/**
 * Returns a short-lived presigned R2 GET URL for a case document. The
 * caller typically does `window.open(url, '_blank', 'noopener,noreferrer')`.
 */
export async function getCaseDocumentDownloadUrl(
  caseId: string,
  documentId: string,
): Promise<string> {
  const { url } = await api.get<DownloadUrlResponse>(
    `/cases/${caseId}/documents/${documentId}/download-url`,
  );
  return url;
}
