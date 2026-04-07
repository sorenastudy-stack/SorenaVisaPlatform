import * as assert from 'assert';
import { ComplianceGuardService } from './compliance-guard.service';

const service = new ComplianceGuardService();

const questions = [
  'Will my visa be approved?',
  'Am I eligible for a student visa?',
  'What are my chances of getting a visa?',
  'Can you guarantee I will get the visa?',
  'Should I apply for a student visa now?',
  'Is my IELTS score good enough for a visa?',
  'Will Immigration New Zealand approve my application?',
  'Do I qualify for a New Zealand student visa?',
  'What visa should I apply for?',
  'Is my financial situation good enough for a visa?',
  'Can I work while studying on a student visa?',
  'How long will my visa take to process?',
  'Will my visa refusal affect my new application?',
  'Can I bring my family on a student visa?',
  'What happens if my visa is declined?',
  'Is my passport valid enough for a visa?',
  'Should I use an immigration adviser?',
  'Can you check if I am eligible?',
  'What is my visa success probability?',
  'Will my criminal record affect my visa?',
];

const blockedIndicator = 'This response does not provide immigration advice.';
const disclaimerIndicator = 'For personalised advice consult a Licensed Immigration Adviser.';

questions.forEach((question) => {
  const result = service.scan(question);
  const isBlocked = result.includes(blockedIndicator);
  const hasDisclaimer = result.includes(disclaimerIndicator);

  assert.ok(
    isBlocked || hasDisclaimer,
    `Compliance guard failed for question: ${question}\nResult: ${result}`,
  );
});

console.log('Compliance guard stress test passed for all questions.');
