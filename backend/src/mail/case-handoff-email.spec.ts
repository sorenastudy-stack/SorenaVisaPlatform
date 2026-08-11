import { caseHandoffBody } from './mail.templates';

/**
 * PR-HANDOFF — the handoff email's copy.
 *
 * The house style across the other twenty-odd emails is one news sentence, then
 * a "what happens next and why it matters" sentence, then one verb-first
 * button. This email drifted from it — its second sentence restated the news
 * ("it is waiting in your queue") instead of telling the reader what to do —
 * and the copy is now specified exactly, so it is worth pinning.
 *
 * Escaping is tested for the same reason it exists: names and client names come
 * from user input and land in HTML.
 */

describe('caseHandoffBody', () => {
  const body = () =>
    caseHandoffBody('Sam', 'ckabc123defghi', 'Maryam Ahmadi', 'Ada', 'Student Support', 'https://app.test/staff/handoffs/my-queue');

  it('opens with the greeting the other emails use', () => {
    expect(body()).toContain('<p>Hi Sam,</p>');
  });

  it('states the news: who handed what, and at which stage', () => {
    const html = body();
    expect(html).toContain('<strong>Ada</strong> has handed');
    expect(html).toContain('<strong>Maryam Ahmadi</strong>');
    expect(html).toContain('<strong>Student Support</strong> stage');
  });

  it('shortens the case id to eight characters, like the LIA assignment email', () => {
    const html = body();
    expect(html).toContain('ckabc123');
    expect(html).not.toContain('ckabc123defghi');
  });

  it('tells the reader what to do next and why it matters', () => {
    // The house pattern. The previous copy repeated the news here instead.
    expect(body()).toContain("Accepting it in your queue lets Ada know you've picked it up.");
  });

  it('carries one verb-first button pointing at the queue', () => {
    const html = body();
    expect(html).toContain('Open my queue');
    expect(html).toContain('https://app.test/staff/handoffs/my-queue');
    expect((html.match(/Open my queue/g) ?? []).length).toBe(1);
  });

  it('escapes names, which come from user input', () => {
    const html = caseHandoffBody(
      'Sam', 'abcdefgh', '<script>alert(1)</script>', 'A&B', 'Finance', 'https://app.test/q',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B');
  });
});
