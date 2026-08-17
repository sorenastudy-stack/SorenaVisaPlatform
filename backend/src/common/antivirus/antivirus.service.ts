import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import * as fs from 'fs';

// PR-AV slice 1 — malware scanning, via clamd on the private network.
//
// Talks clamd's INSTREAM protocol over TCP directly rather than pulling in a
// wrapper package: the protocol is four lines of framing, and a dependency here
// would be a third-party package sitting on the money path for no gain.
//
//   → "zINSTREAM\0"
//   → <uint32 BE length><chunk> … repeated
//   → <uint32 BE 0>            (terminator)
//   ← "stream: OK\0"  |  "stream: <Signature> FOUND\0"  |  "… ERROR\0"
//
// FAIL CLOSED. If clamd cannot be reached, times out, or answers something this
// code does not understand, the verdict is UNAVAILABLE and the caller must
// refuse the upload. A scanner that silently stops scanning is worse than no
// scanner, because the control still appears to be there. The caller
// distinguishes UNAVAILABLE from INFECTED so the person sees "try again shortly"
// rather than "try a different file" — one is our problem, the other is theirs.

export type ScanVerdict =
  | { status: 'CLEAN' }
  | { status: 'INFECTED'; signature: string }
  | { status: 'UNAVAILABLE'; reason: string };

const CHUNK = 64 * 1024;

@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);

  private get host(): string { return process.env.CLAMAV_HOST ?? ''; }
  private get port(): number { return Number(process.env.CLAMAV_PORT ?? 3310); }
  private get timeoutMs(): number { return Number(process.env.CLAMAV_TIMEOUT_MS ?? 20_000); }

  /** Is scanning configured at all? Used to fail loudly at the call site. */
  get configured(): boolean { return this.host.length > 0; }

  /** Scan a file already on disk (multer wrote it before the handler ran). */
  async scanFile(path: string): Promise<ScanVerdict> {
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(path, { highWaterMark: CHUNK });
    } catch (e: any) {
      return { status: 'UNAVAILABLE', reason: `could not read file: ${e?.message ?? e}` };
    }
    return this.scanStream(stream);
  }

  /** Scan an in-memory buffer (the multipart paths that use memoryStorage). */
  async scanBuffer(buf: Buffer): Promise<ScanVerdict> {
    const { Readable } = await import('stream');
    return this.scanStream(Readable.from(buf, { objectMode: false }));
  }

  private scanStream(source: NodeJS.ReadableStream): Promise<ScanVerdict> {
    if (!this.configured) {
      return Promise.resolve({ status: 'UNAVAILABLE', reason: 'CLAMAV_HOST is not set' });
    }

    return new Promise<ScanVerdict>((resolve) => {
      let settled = false;
      const done = (v: ScanVerdict) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* already gone */ }
        try { (source as any).destroy?.(); } catch { /* already gone */ }
        resolve(v);
      };

      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs);

      let reply = '';
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        source.on('data', (c: Buffer | string) => {
          const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          // Back-pressure matters: a 10 MB receipt is 160 writes, and ignoring
          // the return value here is how a large upload silently truncates.
          if (!socket.write(Buffer.concat([len, chunk]))) source.pause();
        });
        socket.on('drain', () => source.resume());
        source.on('end', () => {
          const term = Buffer.alloc(4);
          term.writeUInt32BE(0, 0);
          socket.write(term);
        });
        source.on('error', (e: any) => done({ status: 'UNAVAILABLE', reason: `read failed: ${e?.message ?? e}` }));
      });

      socket.on('data', (d) => { reply += d.toString('utf8'); });
      socket.on('timeout', () => done({ status: 'UNAVAILABLE', reason: `clamd timed out after ${this.timeoutMs}ms` }));
      socket.on('error', (e: any) => done({ status: 'UNAVAILABLE', reason: `clamd unreachable: ${e?.message ?? e}` }));
      socket.on('close', () => {
        const text = reply.replace(/\0/g, '').trim();
        if (/\bOK$/.test(text)) return done({ status: 'CLEAN' });
        const found = text.match(/^stream:\s*(.+?)\s+FOUND$/);
        if (found) return done({ status: 'INFECTED', signature: found[1] });
        // Anything else — including an empty reply — is not a clean verdict.
        done({ status: 'UNAVAILABLE', reason: text ? `unexpected reply: ${text.slice(0, 120)}` : 'no reply from clamd' });
      });
    });
  }

  /** For the health endpoint: does clamd answer PING with PONG? */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.configured) return { ok: false, detail: 'CLAMAV_HOST is not set' };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean, detail: string) => {
        if (settled) return;
        settled = true;
        try { s.destroy(); } catch { /* */ }
        resolve({ ok, detail });
      };
      const s = net.createConnection({ host: this.host, port: this.port });
      s.setTimeout(5000);
      let buf = '';
      s.on('connect', () => s.write('zPING\0'));
      s.on('data', (d) => {
        buf += d.toString('utf8');
        if (buf.includes('PONG')) finish(true, 'PONG');
      });
      s.on('timeout', () => finish(false, 'timed out'));
      s.on('error', (e: any) => finish(false, e?.message ?? String(e)));
      s.on('close', () => finish(buf.includes('PONG'), buf.replace(/\0/g, '').trim() || 'closed with no reply'));
    });
  }
}
