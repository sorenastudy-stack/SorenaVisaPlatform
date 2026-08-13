/**
 * PR-FEE-COPY-2 — emit the frontend's copy of the fee table from fee-config.
 *
 * WHY THIS EXISTS. `feeLabel()` fixed prices in backend prose, but the frontend
 * has no access to fee-config: separate builds, no shared module, no fee
 * endpoint. So every price a client reads on a page was necessarily hand-typed,
 * which is why the same bug kept coming back — a marketing line saying "$200"
 * when the charge is 230, a CTA reading "Pay NZD 30" for a USD 23.00 session.
 *
 * This generates `frontend/src/lib/fees.generated.ts` from the same functions
 * that decide what a client is actually charged. Regenerate with:
 *
 *   npm run gen:fees            (and `npm run gen:fees:check` in CI)
 *
 * A build-time file rather than an endpoint: the marketing page is static and
 * should not depend on a network call to state a price, and both services
 * deploy together from main, so a price change reaches both in one release.
 *
 * ── ON PICKING THE RIGHT QUANTITY ────────────────────────────────────────────
 * Deriving from fee-config is not sufficient on its own. routing.ts already
 * read fee-config and still quoted USD 200, because it rendered `priceCents`
 * (the pre-GST base) where the client pays 230. So this file emits every
 * quantity EXPLICITLY NAMED — base / gst / bankTotal / cardTotal — and callers
 * choose one deliberately instead of reaching for whatever field is nearest.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FeeType, getFee, calculateFeeBreakdown, GST_RATE, formatFeeAmount } from '../src/payments/fee-config';

const TYPES: FeeType[] = [
  'ACCOUNT_OPENING',
  'LIA_CONSULTATION',
  'ADMISSION_CONSULTATION',
  'GAP_CLOSING',
  'FREE_15',
];

// The SAME prose formatter the backend's feeLabel() uses, so a sentence on a
// page and a sentence in a PDF cannot render one price two ways.
const money = formatFeeAmount;

function build(): string {
  const rows = TYPES.map((type) => {
    const fee = getFee(type);
    const bank = calculateFeeBreakdown(fee.priceCents, 'bank', fee.currency);
    const card = calculateFeeBreakdown(fee.priceCents, 'card', fee.currency);
    const cur = fee.currency.toUpperCase();
    return `  ${type}: {
    currency: '${cur}',
    baseCents: ${bank.baseCents},
    gstCents: ${bank.gstCents},
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: ${bank.totalCents},
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: ${card.totalCents},
    /** "${money(bank.baseCents, cur)}" — the list price, GST NOT included. */
    base: '${money(bank.baseCents, cur)}',
    /** "${money(bank.totalCents, cur)}" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: '${money(bank.totalCents, cur)}',
    /** "${money(bank.totalCents, cur)} incl. GST" — what a client will pay. */
    inclGst: '${money(bank.totalCents, cur)} incl. GST',
    /** "${money(bank.baseCents, cur)} + GST" — when the split is stated separately. */
    plusGst: '${money(bank.baseCents, cur)} + GST',
    /** "${money(card.totalCents, cur)}" — total when paying by card. */
    cardTotal: '${money(card.totalCents, cur)}',
  },`;
  }).join('\n');

  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth: backend/src/payments/fee-config.ts
// Regenerate:      cd backend && npm run gen:fees
// CI guard:        npm run gen:fees:check (fails if this file is stale)
//
// Hand-editing a figure here reintroduces exactly the bug this file exists to
// prevent: a price written down in one place and changed in another.
//
// Choose the quantity deliberately. \`base\` is the pre-GST list price and is
// almost never what a client pays — quoting it is how "USD 200" ended up beside
// a USD 230.00 invoice.

export const GST_RATE = ${GST_RATE};
export const GST_PERCENT_LABEL = 'GST ${Math.round(GST_RATE * 100)}%';

export interface FeeCopy {
  currency: string;
  baseCents: number;
  gstCents: number;
  bankTotalCents: number;
  cardTotalCents: number;
  base: string;
  total: string;
  inclGst: string;
  plusGst: string;
  cardTotal: string;
}

export const FEES = {
${rows}
} as const satisfies Record<string, FeeCopy>;

export type GeneratedFeeType = keyof typeof FEES;

/** The amount a client pays, spelled out — the safe default for prose. */
export function feeInclGst(type: GeneratedFeeType): string {
  return FEES[type].inclGst;
}
`;
}

const OUT = path.resolve(__dirname, '../../frontend/src/lib/fees.generated.ts');
const next = build();
const check = process.argv.includes('--check');

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== next) {
    console.error(
      '\nfees.generated.ts is STALE.\n\n' +
      'fee-config.ts has changed but the frontend copy was not regenerated, so a\n' +
      'page would state a price the platform no longer charges.\n\n' +
      '  cd backend && npm run gen:fees\n',
    );
    process.exit(1);
  }
  console.log('fees.generated.ts is up to date.');
} else {
  fs.writeFileSync(OUT, next, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  for (const t of TYPES) {
    const f = getFee(t);
    const b = calculateFeeBreakdown(f.priceCents, 'bank', f.currency);
    const c = calculateFeeBreakdown(f.priceCents, 'card', f.currency);
    console.log(`  ${t.padEnd(24)} base ${money(b.baseCents, f.currency)}  ` +
      `bank ${money(b.totalCents, f.currency)}  card ${money(c.totalCents, f.currency)}`);
  }
}
