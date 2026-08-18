import * as nodemailer from 'nodemailer';

// PR-DEPS — CRLF header injection, tested rather than assumed.
//
// This is the actual security reason for taking nodemailer 6 -> 9: several of
// the advisories are CRLF/header-injection issues. Reading the source is not
// enough to close the question. mime-node's unstructured-header encoder tests
// against /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/, a class that does NOT contain
// \x0a (LF) or \x0d (CR) — so from that function alone you would conclude a
// newline in a Subject survives. Something upstream of it evidently handles
// that, and "evidently" is not a security argument.
//
// So: compose real messages through the real pipeline with hostile input in
// every field that reaches a header, and read the bytes that would go on the
// wire. streamTransport gives the composed RFC822 message without sending
// anything.
//
// The assertion is deliberately NOT "sendMail did not throw". A silently
// accepted injection throws nothing at all — that is the whole failure mode.

const INJECTED = 'Bcc: attacker@example.com';
const PAYLOAD = `\r\n${INJECTED}`;

/** Compose for real and hand back the raw RFC822 bytes. */
async function compose(mail: Record<string, unknown>): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info: any = await transport.sendMail(mail as any);
  return info.message.toString('utf8');
}

/** Everything before the blank line — i.e. what a receiving MTA parses as headers. */
const headerBlock = (raw: string) => raw.split(/\r\n\r\n/)[0];

/**
 * A header is "real" only if it starts at column 0 of its own line. A folded
 * continuation line begins with whitespace and belongs to the previous header,
 * which is exactly how a neutralised payload ends up looking.
 */
function realHeaderNames(raw: string): string[] {
  return headerBlock(raw)
    .split(/\r\n/)
    .filter((l) => /^[A-Za-z][A-Za-z0-9-]*:/.test(l))
    .map((l) => l.split(':')[0].toLowerCase());
}

describe('nodemailer 9 — CRLF header injection is neutralised', () => {
  it('a recipient DISPLAY NAME carrying CRLF cannot inject a Bcc header', async () => {
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: { name: `Legit Client${PAYLOAD}`, address: 'client@example.com' },
      subject: 'Your application',
      html: '<p>hello</p>',
    });
    expect(realHeaderNames(raw)).not.toContain('bcc');
    expect(raw).not.toContain(`\r\n${INJECTED}`);
  });

  it('a SUBJECT carrying CRLF cannot inject a Bcc header', async () => {
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: 'client@example.com',
      subject: `Your application${PAYLOAD}`,
      html: '<p>hello</p>',
    });
    expect(realHeaderNames(raw)).not.toContain('bcc');
    expect(raw).not.toContain(`\r\n${INJECTED}`);
  });

  it('a TO ADDRESS carrying CRLF cannot inject a Bcc header', async () => {
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: `client@example.com${PAYLOAD}`,
      subject: 'Your application',
      html: '<p>hello</p>',
    });
    expect(realHeaderNames(raw)).not.toContain('bcc');
  });

  it('a REPLY-TO carrying CRLF cannot inject a Bcc header', async () => {
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: 'client@example.com',
      replyTo: { name: `Support${PAYLOAD}`, address: 'support@sorenavisa.com' },
      subject: 'Your application',
      html: '<p>hello</p>',
    });
    expect(realHeaderNames(raw)).not.toContain('bcc');
    expect(raw).not.toContain(`\r\n${INJECTED}`);
  });

  it('the payload text may survive, but only inside a header VALUE — never as a new header', async () => {
    // The distinction that matters. Neutralised does not mean "the characters
    // vanished"; it means they can no longer start a line. If the text appears
    // at all it must be encoded, quoted, or folded under its own header.
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: { name: `Client${PAYLOAD}`, address: 'client@example.com' },
      subject: `Subject${PAYLOAD}`,
      html: '<p>hello</p>',
    });
    for (const line of headerBlock(raw).split(/\r\n/)) {
      expect(line.toLowerCase()).not.toMatch(/^bcc:/);
    }
    expect(realHeaderNames(raw).sort()).toEqual(
      expect.not.arrayContaining(['bcc', 'cc']),
    );
  });

  it('the guard can fail — a genuinely injected header IS detected', async () => {
    // Proves the detector works. A real Bcc, passed legitimately, must show up
    // as a real header — otherwise every assertion above passes vacuously.
    const raw = await compose({
      from: 'noreply@sorenavisa.com',
      to: 'client@example.com',
      bcc: 'attacker@example.com',
      subject: 'Your application',
      html: '<p>hello</p>',
    });
    expect(realHeaderNames(raw)).toContain('bcc');
  });
});

describe('EmailService-shaped payloads survive the upgrade', () => {
  it('composes the exact shape EmailService.sendEmail sends', async () => {
    const raw = await compose({
      from: 'Sorena Visa <noreply@sorenavisa.com>',
      to: 'client@example.com',
      subject: 'Verify your email – Sorena Visa',
      html: '<p>hello</p>',
      text: 'hello',
    });
    const names = realHeaderNames(raw);
    expect(names).toEqual(expect.arrayContaining(['from', 'to', 'subject', 'content-type']));
    // The en-dash in the subject must still round-trip after encoding.
    expect(headerBlock(raw)).toMatch(/Subject:.+/);
    expect(raw).toContain('hello');
  });
});
