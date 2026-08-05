// PR-IMPORT — read-only review export of the locally-imported catalogue.
//
// Produces a single self-contained HTML file (no server, no build) so the Owner can
// eyeball all 91 institutions and 1,124 programmes before anything touches
// production. READ ONLY: opens a Prisma client, selects, writes a file. Nothing in
// the database is modified.
//
// Usage: npx ts-node --transpile-only scripts/catalogue-review-export.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

(async () => {
  const prisma = new PrismaClient();

  const providers = await prisma.educationProvider.findMany({
    where: { programmes: { some: { sourceRef: { not: null } } } },
    include: {
      programmes: {
        where: { sourceRef: { not: null } },
        orderBy: [{ subjectAreaRaw: 'asc' }, { nzqfLevel: 'asc' }, { name: 'asc' }],
      },
    },
    orderBy: [{ institutionType: 'asc' }, { name: 'asc' }],
  });

  const totalProgrammes = providers.reduce((a, p) => a + p.programmes.length, 0);
  const byType: Record<string, number> = {};
  providers.forEach((p) => { const k = String(p.institutionType ?? '—'); byType[k] = (byType[k] ?? 0) + 1; });

  const sections = providers.map((p, idx) => {
    const tabs = new Map<string, typeof p.programmes>();
    for (const g of p.programmes) {
      const k = g.subjectAreaRaw ?? 'Unspecified';
      (tabs.get(k) ?? tabs.set(k, []).get(k)!).push(g);
    }
    const tabList = [...tabs.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    const rows = tabList.map(([label, progs]) => `
      <tr class="sa"><td colspan="7">${esc(label)} <span class="n">${progs.length}</span></td></tr>
      ${progs.map((g) => `
      <tr>
        <td class="nm">${esc(g.name)}${g.majorStrand ? `<div class="strand">${esc(g.majorStrand)}</div>` : ''}</td>
        <td class="ctr">${esc(String(g.nzqfLevel ?? '').replace('LEVEL_', ''))}</td>
        <td>${esc(g.qualificationType)}</td>
        <td class="fee">${g.tuitionFeeNZD != null
            ? `<b>NZ$${g.tuitionFeeNZD.toLocaleString()}</b>`
            : `<span class="raw">${esc(g.tuitionFeeRaw ?? '—')}</span>${g.tuitionParseNote ? `<div class="why">${esc(g.tuitionParseNote)}</div>` : ''}`}</td>
        <td>${esc(g.durationText)}</td>
        <td>${esc(g.campusCity)}</td>
        <td class="ctr"><span class="pill ${g.reviewStatus === 'APPROVED' ? 'ok' : 'pend'}">${esc(g.reviewStatus)}</span></td>
      </tr>`).join('')}`).join('');

    return `
    <details ${idx < 2 ? 'open' : ''}>
      <summary>
        <span class="inst">${esc(p.name)}</span>
        <span class="badge type">${esc(p.institutionType ?? p.providerType)}</span>
        <span class="badge ${p.status === 'ACTIVE' ? 'active' : 'pending'}">${esc(p.status)}${p.status !== 'ACTIVE' ? ' · no agreement yet' : ''}</span>
        <span class="counts">${p.programmes.length} programmes · ${tabList.length} subject area${tabList.length === 1 ? '' : 's'}</span>
      </summary>
      ${p.brand && p.brand !== p.name ? `<p class="brand">Brand: ${esc(p.brand)}</p>` : ''}
      <table>
        <thead><tr><th>Programme</th><th>Lvl</th><th>Type</th><th>Tuition</th><th>Duration</th><th>Campus</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
  }).join('');

  const html = `<!doctype html><meta charset="utf-8">
<title>Imported catalogue — review (local dev)</title>
<style>
 :root{--navy:#1e3a5f;--gold:#c9a961;--cream:#faf8f3;--line:#e6e1d6;--jade:#15a86b}
 *{box-sizing:border-box} body{margin:0;background:var(--cream);color:#3d3d3d;font:14px/1.5 Inter,system-ui,sans-serif}
 header{background:var(--navy);color:#fff;padding:18px 24px;position:sticky;top:0;z-index:5}
 header h1{margin:0;font-size:18px} header p{margin:4px 0 0;font-size:13px;opacity:.85}
 .wrap{max-width:1300px;margin:0 auto;padding:20px 24px 60px}
 .warn{background:#fff8e1;border:1px solid var(--gold);border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:18px}
 details{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
 summary{cursor:pointer;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
 summary::-webkit-details-marker{display:none}
 .inst{font-weight:700;color:var(--navy)}
 .badge{font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px}
 .type{background:rgba(30,58,95,.08);color:var(--navy)}
 .pending{background:rgba(201,169,97,.22);color:#7a6320}
 .active{background:rgba(21,168,107,.15);color:var(--jade)}
 .counts{margin-left:auto;font-size:12px;color:#8a8375}
 .brand{margin:0 16px 8px;font-size:12px;color:#8a8375}
 table{width:100%;border-collapse:collapse;font-size:12.5px}
 th{text-align:left;background:var(--cream);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:7px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8a8375}
 td{padding:7px 10px;border-bottom:1px solid #f2efe8;vertical-align:top}
 tr.sa td{background:#f7f4ec;font-weight:700;color:var(--navy);font-size:12px}
 tr.sa .n{color:#8a8375;font-weight:600}
 .nm{font-weight:600;color:var(--navy);max-width:340px}
 .strand{font-weight:400;color:#8a8375;font-size:11.5px;margin-top:2px}
 .ctr{text-align:center}
 .fee{max-width:280px}
 .raw{color:#6b6357;font-style:italic}
 .why{color:#a09786;font-size:11px;margin-top:2px}
 .pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px}
 .pill.pend{background:rgba(201,169,97,.22);color:#7a6320}
 .pill.ok{background:rgba(21,168,107,.15);color:var(--jade)}
</style>
<header>
  <h1>Imported catalogue — review copy</h1>
  <p>${providers.length} institutions · ${totalProgrammes} programmes · ${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
</header>
<div class="wrap">
  <div class="warn"><b>LOCAL DEV DATA — production is untouched.</b> Every institution is <b>PENDING</b> (no agreement yet) and every programme is <b>PENDING</b> (not approved, not visible to students). Tuition shown in italics is the institution's own wording, kept verbatim because the source states it conditionally.</div>
  ${sections}
</div>`;

  const out = path.join(process.cwd(), 'docs', 'catalogue-review.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`wrote ${out}`);
  console.log(`  ${providers.length} institutions · ${totalProgrammes} programmes · ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
