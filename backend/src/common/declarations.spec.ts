import * as fs from 'fs';
import * as path from 'path';
import { DeclarationType } from '@prisma/client';
import {
  DECLARATION_MESSAGE_KEYS,
  declarationParagraphs,
  declarationText,
  DECLARATION_VERSION,
} from './declarations';

// PR-PHASE39 — the guard that makes declarations.ts trustworthy.
//
// The audit row stores the SERVER's copy of the declaration, because a
// client-sent string proves nothing. That is only honest while the server's
// copy is what the client actually rendered — and nothing in the type system
// links a constant in this file to a string in the frontend's en.json.
//
// So this reads en.json directly and compares character for character. Reword a
// declaration on the client without updating the server, and this fails: the
// snapshot would otherwise quietly record text nobody ever saw.

const EN_PATH = path.resolve(__dirname, '../../../frontend/src/i18n/messages/en.json');

describe('declaration text matches what the client renders', () => {
  const en: Record<string, unknown> = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));

  const types = Object.keys(DECLARATION_MESSAGE_KEYS) as DeclarationType[];

  it.each(types)('%s is identical to en.json', (type) => {
    const keys = DECLARATION_MESSAGE_KEYS[type];
    const fromClient = keys.map((k) => {
      const v = en[k];
      expect(typeof v).toBe('string');   // a renamed key must fail loudly too
      return v as string;
    });
    expect(declarationParagraphs(type)).toEqual(fromClient);
  });

  it('joins paragraphs in the order they are read', () => {
    const text = declarationText('ADMISSION_ACCEPTANCE');
    const paras = declarationParagraphs('ADMISSION_ACCEPTANCE');
    expect(text).toBe(paras.join('\n\n'));
    // The acceptance label is last on screen; a reordering here would change
    // the meaning of an archived record.
    expect(text.endsWith(paras[paras.length - 1])).toBe(true);
  });

  it('covers every DeclarationType the schema allows', () => {
    // A new enum value with no text would snapshot an empty declaration.
    const schemaValues: DeclarationType[] = [
      'AGENT_DECLARATION', 'ADMISSION_ACCEPTANCE', 'VISA_SUBMIT_DECLARATION',
    ];
    expect(types.sort()).toEqual(schemaValues.sort());
    for (const t of schemaValues) expect(declarationText(t).length).toBeGreaterThan(20);
  });

  it('carries a version, so a reword is never retroactive', () => {
    expect(DECLARATION_VERSION).toMatch(/^declarations-v\d+-\d{4}-\d{2}$/);
  });
});
