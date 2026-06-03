/**
 * PR-DOCUSIGN-1 step 5 piece 1 — pure-function spec for
 * buildEnvelopeDefinition().
 *
 * Asserts on the exact shape of the docusign.EnvelopeDefinition
 * instance the SDK is about to consume. No network. No Nest context.
 * No Prisma. CI-safe.
 *
 * Five tests:
 *   1. 3-signer sequential routing (recipient IDs + routing orders +
 *      identity in order)
 *   2. Single document (documentId='1', name + extension, base64 round-trip)
 *   3. SignHere tabs (one per signer, all on documentId='1', distinct
 *      y-positions ascending with routingOrder)
 *   4. Subject + blurb pass through
 *   5. envelopeDefinition.status === 'sent'
 *
 * The companion piece-2 work will rewire createEnvelope() to call this
 * builder and dispatch via the SDK. piece-3 wires the webhook.
 */

import { ContractSignerRole } from '@prisma/client';
import {
  buildEnvelopeDefinition,
  EnvelopeDocumentSpec,
  EnvelopeRecipientSpec,
  BuildEnvelopeOptions,
} from './docusign.service';

describe('buildEnvelopeDefinition (PR-DOCUSIGN-1 step 5 piece 1)', () => {
  const PLACEHOLDER_BYTES = Buffer.from('placeholder document bytes for the spec');

  const docs: EnvelopeDocumentSpec[] = [
    {
      documentId:    '1',
      name:          'Engagement letter.pdf',
      fileExtension: 'pdf',
      bytes:         PLACEHOLDER_BYTES,
    },
  ];

  const signers: EnvelopeRecipientSpec[] = [
    { recipientId: '1', routingOrder: 1, role: ContractSignerRole.CLIENT,   email: 'client@example.com',   name: 'Test Client'   },
    { recipientId: '2', routingOrder: 2, role: ContractSignerRole.LIA,      email: 'lia@example.com',      name: 'Test LIA'      },
    { recipientId: '3', routingOrder: 3, role: ContractSignerRole.DIRECTOR, email: 'director@example.com', name: 'Test Director' },
  ];

  const options: BuildEnvelopeOptions = {
    emailSubject: 'Sorena engagement letter — signature required',
    emailBlurb:   'Please review and sign the attached engagement letter.',
  };

  // ─── Test 1 — 3-signer sequential routing ─────────────────────────────

  it('test 1: 3-signer sequential routing (CLIENT → LIA → DIRECTOR)', () => {
    const env = buildEnvelopeDefinition(docs, signers, options);
    const out = env.recipients?.signers;
    expect(out).toHaveLength(3);

    expect(out![0].recipientId).toBe('1');
    expect(out![0].routingOrder).toBe('1');
    expect(out![0].email).toBe('client@example.com');
    expect(out![0].name).toBe('Test Client');

    expect(out![1].recipientId).toBe('2');
    expect(out![1].routingOrder).toBe('2');
    expect(out![1].email).toBe('lia@example.com');
    expect(out![1].name).toBe('Test LIA');

    expect(out![2].recipientId).toBe('3');
    expect(out![2].routingOrder).toBe('3');
    expect(out![2].email).toBe('director@example.com');
    expect(out![2].name).toBe('Test Director');
  });

  // ─── Test 2 — Single document ─────────────────────────────────────────

  it('test 2: single document with correct id, name, extension, base64', () => {
    const env = buildEnvelopeDefinition(docs, signers, options);
    expect(env.documents).toHaveLength(1);
    const d = env.documents![0];
    expect(d.documentId).toBe('1');
    expect(d.name).toBe('Engagement letter.pdf');
    expect(d.fileExtension).toBe('pdf');
    expect(d.documentBase64).toBe(PLACEHOLDER_BYTES.toString('base64'));
    // Round-trip the base64 back to bytes and confirm content match.
    expect(Buffer.from(d.documentBase64!, 'base64').equals(PLACEHOLDER_BYTES)).toBe(true);
  });

  // ─── Test 3 — SignHere tabs ───────────────────────────────────────────

  it('test 3: one SignHere tab per signer on doc 1, ascending y by routingOrder', () => {
    const env = buildEnvelopeDefinition(docs, signers, options);
    const out = env.recipients!.signers!;

    for (let i = 0; i < 3; i++) {
      const tabs = out[i].tabs?.signHereTabs;
      expect(tabs).toHaveLength(1);
      const tab = tabs![0];
      expect(tab.documentId).toBe('1');
      expect(tab.pageNumber).toBe('1');
      expect(tab.recipientId).toBe(out[i].recipientId);
      expect(tab.xPosition).toBe('100');
      // tabLabel includes the role + recipientId for debug clarity.
      expect(tab.tabLabel).toMatch(/^SignHere_(CLIENT|LIA|DIRECTOR)_\d+$/);
    }

    // Each tab's y MUST be strictly greater than the previous one so
    // signatures don't overlap on the placeholder PDF.
    const y1 = Number(out[0].tabs!.signHereTabs![0].yPosition);
    const y2 = Number(out[1].tabs!.signHereTabs![0].yPosition);
    const y3 = Number(out[2].tabs!.signHereTabs![0].yPosition);
    expect(y2).toBeGreaterThan(y1);
    expect(y3).toBeGreaterThan(y2);
  });

  // ─── Test 4 — Subject + blurb pass through ────────────────────────────

  it('test 4: emailSubject and emailBlurb pass through from options', () => {
    const env = buildEnvelopeDefinition(docs, signers, options);
    expect(env.emailSubject).toBe('Sorena engagement letter — signature required');
    expect(env.emailBlurb).toBe('Please review and sign the attached engagement letter.');
  });

  // ─── Test 5 — Envelope status === 'sent' ──────────────────────────────

  it("test 5: envelope status is 'sent' (dispatches immediately on creation)", () => {
    const env = buildEnvelopeDefinition(docs, signers, options);
    expect(env.status).toBe('sent');
  });
});
