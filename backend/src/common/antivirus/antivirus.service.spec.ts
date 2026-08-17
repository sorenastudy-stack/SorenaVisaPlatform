import * as net from 'net';
import { AntivirusService } from './antivirus.service';

// PR-AV slice 1 — the INSTREAM client, against a fake clamd.
//
// Runs without ClamAV so it holds in CI. What it pins down is the part that
// silently misbehaves: reply parsing, and the fail-closed contract. A scanner
// that returns CLEAN when it did not understand the answer is worse than no
// scanner, because the control still looks present.

/** A minimal clamd that replies however the test wants. */
function fakeClamd(reply: string | null, opts: { silent?: boolean } = {}) {
  const received: Buffer[] = [];
  const server = net.createServer((sock) => {
    sock.on('data', (d) => {
      received.push(d);
      // The terminator is a 4-byte zero length at the end of the stream.
      const buf = Buffer.concat(received);
      const endsWithZero = buf.length >= 4 && buf.readUInt32BE(buf.length - 4) === 0;
      if (endsWithZero && !opts.silent) {
        if (reply !== null) sock.write(reply);
        sock.end();
      }
    });
  });
  return {
    server,
    received: () => Buffer.concat(received),
    listen: () =>
      new Promise<number>((res) => server.listen(0, '127.0.0.1', () => res((server.address() as net.AddressInfo).port))),
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

const withClamd = async (reply: string | null, body: Buffer, opts: { silent?: boolean } = {}) => {
  const fake = fakeClamd(reply, opts);
  const port = await fake.listen();
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(port);
  process.env.CLAMAV_TIMEOUT_MS = '2000';
  const svc = new AntivirusService();
  const verdict = await svc.scanBuffer(body);
  const sent = fake.received();
  await fake.close();
  return { verdict, sent };
};

describe('the clamd INSTREAM client', () => {
  afterEach(() => { delete process.env.CLAMAV_HOST; });

  it('reads a clean verdict', async () => {
    const { verdict } = await withClamd('stream: OK\0', Buffer.from('harmless'));
    expect(verdict).toEqual({ status: 'CLEAN' });
  });

  it('reads an infected verdict, and keeps the signature name', async () => {
    const { verdict } = await withClamd('stream: Win.Test.EICAR_HDB-1 FOUND\0', Buffer.from('x'));
    expect(verdict).toEqual({ status: 'INFECTED', signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('frames the request the way clamd expects', async () => {
    const body = Buffer.from('hello world');
    const { sent } = await withClamd('stream: OK\0', body);
    expect(sent.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    // <uint32 length><payload><uint32 0>
    expect(sent.readUInt32BE(10)).toBe(body.length);
    expect(sent.subarray(14, 14 + body.length).toString()).toBe('hello world');
    expect(sent.readUInt32BE(sent.length - 4)).toBe(0);
  });

  it('sends the whole body, not just the first chunk', async () => {
    // Larger than the 64 KB read size, so it must be framed as several chunks.
    const body = Buffer.alloc(200 * 1024, 0x41);
    const { sent, verdict } = await withClamd('stream: OK\0', body);
    expect(verdict.status).toBe('CLEAN');
    let offset = 10, total = 0;
    while (offset + 4 <= sent.length) {
      const len = sent.readUInt32BE(offset);
      if (len === 0) break;
      total += len;
      offset += 4 + len;
    }
    expect(total).toBe(body.length);
  });
});

describe('it fails CLOSED — never CLEAN by accident', () => {
  afterEach(() => { delete process.env.CLAMAV_HOST; });

  it('an unparseable reply is UNAVAILABLE, not CLEAN', async () => {
    const { verdict } = await withClamd('something went sideways\0', Buffer.from('x'));
    expect(verdict.status).toBe('UNAVAILABLE');
  });

  it('an empty reply is UNAVAILABLE', async () => {
    const { verdict } = await withClamd(null, Buffer.from('x'));
    expect(verdict.status).toBe('UNAVAILABLE');
  });

  it('a clamd ERROR is UNAVAILABLE', async () => {
    const { verdict } = await withClamd('INSTREAM size limit exceeded. ERROR\0', Buffer.from('x'));
    expect(verdict.status).toBe('UNAVAILABLE');
  });

  it('a hang is UNAVAILABLE, and does not wait forever', async () => {
    const started = Date.now();
    const { verdict } = await withClamd(null, Buffer.from('x'), { silent: true });
    expect(verdict.status).toBe('UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10000);

  it('an unreachable clamd is UNAVAILABLE', async () => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1'; // nothing listens here
    process.env.CLAMAV_TIMEOUT_MS = '2000';
    const verdict = await new AntivirusService().scanBuffer(Buffer.from('x'));
    expect(verdict.status).toBe('UNAVAILABLE');
  });

  it('an unconfigured scanner is UNAVAILABLE rather than skipped', async () => {
    delete process.env.CLAMAV_HOST;
    const svc = new AntivirusService();
    expect(svc.configured).toBe(false);
    const verdict = await svc.scanBuffer(Buffer.from('x'));
    expect(verdict).toEqual({ status: 'UNAVAILABLE', reason: 'CLAMAV_HOST is not set' });
  });
});

describe('the receipt handler is the ONLY caller in this slice', () => {
  const read = (p: string) => require('fs').readFileSync(require.resolve(p), 'utf8');

  it('scans before the invoice row is written', () => {
    const svc = read('../../portal/portal.service.ts');
    const body = svc.slice(svc.indexOf('async uploadInvoiceReceipt('));
    expect(body.indexOf('this.antivirus.scanFile(')).toBeLessThan(body.indexOf('this.prisma.invoice.update('));
  });

  it('deletes the file on both rejection paths', () => {
    const svc = read('../../portal/portal.service.ts');
    const body = svc.slice(svc.indexOf('const verdict = await this.antivirus.scanFile'), svc.indexOf('await this.prisma.invoice.update('));
    expect((body.match(/cleanup\(\);/g) ?? []).length).toBe(2);
  });

  it('tells the uploader nothing technical about a detection', () => {
    const svc = read('../../portal/portal.service.ts');
    expect(svc).toMatch(/This file could not be uploaded\. Please try a different file\./);
    // The signature goes to the audit trail, never to the response. Scoped to
    // the malware block — the file has other, unrelated 422s further up.
    const block = svc.slice(
      svc.indexOf("if (verdict.status === 'INFECTED')"),
      svc.indexOf("if (verdict.status === 'UNAVAILABLE')"),
    );
    expect(block.length).toBeGreaterThan(200); // the slice really found the block
    const thrown = block.slice(block.indexOf('throw new UnprocessableEntityException('));
    expect(thrown).not.toMatch(/signature|verdict|FOUND/);
  });

  it('audits who, what and which threat', () => {
    const svc = read('../../portal/portal.service.ts');
    expect(svc).toMatch(/RECEIPT_UPLOAD_REJECTED_MALWARE/);
    for (const field of ['userId', 'fileName', 'signature', 'sizeBytes']) {
      expect(svc).toMatch(new RegExp(field));
    }
  });

  it('no other upload surface calls the scanner in this slice', () => {
    // Specs are excluded: this spec names the method in its own assertions, and
    // a test file is not an upload surface. Product code only.
    const { execFileSync } = require('child_process');
    const hits = execFileSync(
      'git',
      ['grep', '-l', '-E', 'antivirus\\.(scanFile|scanBuffer)', '--', 'backend/src/**/*.ts'],
      { cwd: require('path').resolve(__dirname, '../../../..'), encoding: 'utf8' },
    )
      .trim().split('\n').filter(Boolean)
      .filter((f: string) => !f.endsWith('.spec.ts'));
    expect(hits).toEqual(['backend/src/portal/portal.service.ts']);
  });
});
