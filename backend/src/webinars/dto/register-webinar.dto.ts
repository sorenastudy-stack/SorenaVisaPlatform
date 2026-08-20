// PR-WEBINAR-1 — Webinar registration DTO marker.
//
// Like the Wix lead-capture DTO (`webhooks/wix/dto/wix-lead-capture.dto.ts`),
// this endpoint is called by an external system whose payload we do not own —
// the sorenavisa.com website. Rather than lock the controller to one shape and
// 400 on the first field-name mismatch, the controller takes the raw body and
// hands it to `normaliseWebinarPayload`, which tolerates field-name synonyms.
//
// This file exists so the controller can name its body parameter consistently
// with the rest of the codebase, and so a future PR that pins the contract down
// has a place to add class-validator contract tests.

export type RegisterWebinarBody = Record<string, unknown>;
