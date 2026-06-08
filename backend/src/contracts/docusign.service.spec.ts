/**
 * PR-DOCUSIGN-1 step 5h — pure-function spec for
 * buildEnvelopeDefinition() in composite-template mode.
 *
 * Post-5h the envelope uses a saved DocuSign template for ALL field
 * positions (signatures, dates, full names, passport, the 11 visa
 * checkboxes + their pick-exactly-one group). The code's only job is
 * to:
 *   - reference the template by templateId,
 *   - map the three live recipients to the template's role names
 *     ("Client" / "LIA" / "Director"),
 *   - substitute our STAMPED engagement-letter PDF as the document.
 *
 * These tests assert only that envelope-level shape. Tab geometry,
 * anchor strings, and checkbox groups live in the template now and
 * are exercised by visual review + a real send probe.
 */

import {
  buildEnvelopeDefinition,
  EnvelopeDocumentSpec,
  EnvelopeRecipientSpec,
  BuildEnvelopeOptions,
  TEMPLATE_ROLE_CLIENT,
  TEMPLATE_ROLE_LIA,
  TEMPLATE_ROLE_DIRECTOR,
} from './docusign.service';

describe('buildEnvelopeDefinition (PR-DOCUSIGN-1 step 5h — composite template)', () => {

  const TEMPLATE_ID = 'c1c1b0f6-533e-4427-98db-c45cd5c666e8';
  const STAMPED_BYTES = Buffer.from('stamped engagement letter bytes for the spec');

  const docs: EnvelopeDocumentSpec[] = [
    {
      documentId:    '1',
      name:          'Engagement letter.pdf',
      fileExtension: 'pdf',
      bytes:         STAMPED_BYTES,
    },
  ];

  const signers: EnvelopeRecipientSpec[] = [
    { recipientId: '1', routingOrder: 1, templateRole: TEMPLATE_ROLE_CLIENT,   email: 'client@example.com',   name: 'Test Client'   },
    { recipientId: '2', routingOrder: 2, templateRole: TEMPLATE_ROLE_LIA,      email: 'lia@example.com',      name: 'Test LIA'      },
    { recipientId: '3', routingOrder: 3, templateRole: TEMPLATE_ROLE_DIRECTOR, email: 'director@example.com', name: 'Test Director' },
  ];

  const options: BuildEnvelopeOptions = {
    emailSubject: 'Sorena engagement letter — signature required',
    emailBlurb:   'Please review and sign the attached engagement letter.',
    templateId:   TEMPLATE_ID,
  };

  // ─── envelope-level shape ─────────────────────────────────────────────

  describe('envelope-level shape', () => {

    it('passes emailSubject + emailBlurb through to the EnvelopeDefinition', () => {
      const env = buildEnvelopeDefinition(docs, signers, options);
      expect(env.emailSubject).toBe('Sorena engagement letter — signature required');
      expect(env.emailBlurb).toBe('Please review and sign the attached engagement letter.');
    });

    it("envelope status is 'sent' (dispatches immediately on creation)", () => {
      const env = buildEnvelopeDefinition(docs, signers, options);
      expect(env.status).toBe('sent');
    });

    it('uses compositeTemplates (NOT top-level documents/recipients)', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      expect(env.compositeTemplates).toHaveLength(1);
      // The composite-template path replaces the top-level fields.
      expect(env.documents).toBeUndefined();
      expect(env.recipients).toBeUndefined();
      expect(env.templateId).toBeUndefined();
    });
  });

  // ─── ServerTemplate — references the saved template's layout ──────────

  describe('ServerTemplate', () => {

    it('carries the templateId from BuildEnvelopeOptions', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ct = env.compositeTemplates[0];
      expect(ct.serverTemplates).toHaveLength(1);
      expect(ct.serverTemplates[0].templateId).toBe(TEMPLATE_ID);
    });

    it("serverTemplate sequence is '1' (applied before inline overrides)", () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      expect(env.compositeTemplates[0].serverTemplates[0].sequence).toBe('1');
    });

    it('throws when templateId is empty', () => {
      expect(() =>
        buildEnvelopeDefinition(docs, signers, { ...options, templateId: '' }),
      ).toThrow(/templateId is required/);
    });
  });

  // ─── InlineTemplate — per-send recipient identities ───────────────────

  describe('InlineTemplate (recipients)', () => {

    it('emits exactly one inlineTemplate at sequence > serverTemplate', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ct = env.compositeTemplates[0];
      expect(ct.inlineTemplates).toHaveLength(1);
      expect(ct.inlineTemplates[0].sequence).toBe('2');
      expect(Number(ct.inlineTemplates[0].sequence)).toBeGreaterThan(
        Number(ct.serverTemplates[0].sequence),
      );
    });

    it('contains 3 signers with recipientId 1/2/3 in CLIENT → LIA → DIRECTOR order', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ss = env.compositeTemplates[0].inlineTemplates[0].recipients.signers;
      expect(ss).toHaveLength(3);
      expect(ss[0].recipientId).toBe('1');
      expect(ss[1].recipientId).toBe('2');
      expect(ss[2].recipientId).toBe('3');
    });

    it("each signer's roleName matches the template's verbatim role names (Client / LIA / Director)", () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ss = env.compositeTemplates[0].inlineTemplates[0].recipients.signers;
      expect(ss[0].roleName).toBe('Client');
      expect(ss[1].roleName).toBe('LIA');
      expect(ss[2].roleName).toBe('Director');
    });

    it('sequential routing order is preserved (string-encoded on the wire)', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ss = env.compositeTemplates[0].inlineTemplates[0].recipients.signers;
      expect(ss[0].routingOrder).toBe('1');
      expect(ss[1].routingOrder).toBe('2');
      expect(ss[2].routingOrder).toBe('3');
    });

    it('each signer carries email + name from the spec', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ss = env.compositeTemplates[0].inlineTemplates[0].recipients.signers;
      expect(ss[0].email).toBe('client@example.com');
      expect(ss[0].name).toBe('Test Client');
      expect(ss[1].email).toBe('lia@example.com');
      expect(ss[1].name).toBe('Test LIA');
      expect(ss[2].email).toBe('director@example.com');
      expect(ss[2].name).toBe('Test Director');
    });

    it('NO signer has .tabs set — all tabs come from the saved template', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const ss = env.compositeTemplates[0].inlineTemplates[0].recipients.signers;
      for (const s of ss) {
        expect(s.tabs).toBeUndefined();
      }
    });
  });

  // ─── Substituted document — the stamped PDF ───────────────────────────

  describe('substituted document', () => {

    it('compositeTemplate.document carries the spec id / name / extension', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const d = env.compositeTemplates[0].document;
      expect(d.documentId).toBe('1');
      expect(d.name).toBe('Engagement letter.pdf');
      expect(d.fileExtension).toBe('pdf');
    });

    it('compositeTemplate.document.documentBase64 round-trips to the stamped bytes', () => {
      const env: any = buildEnvelopeDefinition(docs, signers, options);
      const d = env.compositeTemplates[0].document;
      expect(d.documentBase64).toBe(STAMPED_BYTES.toString('base64'));
      expect(
        Buffer.from(d.documentBase64!, 'base64').equals(STAMPED_BYTES),
      ).toBe(true);
    });

    it('throws when documents.length !== 1 (single-document envelope only)', () => {
      const twoDocs: EnvelopeDocumentSpec[] = [docs[0], { ...docs[0], documentId: '2' }];
      expect(() => buildEnvelopeDefinition(twoDocs, signers, options)).toThrow(
        /expects exactly 1 document/,
      );
      expect(() => buildEnvelopeDefinition([], signers, options)).toThrow(
        /expects exactly 1 document/,
      );
    });
  });
});
