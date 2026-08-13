import { FeeType, getFee, calculateFeeBreakdown } from '../../payments/fee-config';

// PR-FEE-COPY — how a price is written when a client will read it.
//
// Three separate strings in this codebase told clients a wrong price, each
// found by a different sweep: "200 NZD" in the chatbot, "NZD 150" in a hard-stop
// resolution, "$150" on a staff label — all for services priced in USD, all
// left behind when phase 40 unified the fee tables. The prices were never the
// problem; writing them down by hand was.
//
// So a price shown to a person is derived here, from the same function that
// decides what they are actually charged. A fee change moves the copy with it.
//
// GST is included because these labels answer "what will this cost me", and the
// answer a client acts on is the amount that leaves their account. The card fee
// is deliberately excluded: it depends on how they choose to pay, and quoting it
// in prose would overstate the cost of a bank transfer.

/** e.g. "USD 66.70 incl. GST" — what a bank transfer pays, spelled out. */
export function feeLabel(type: FeeType): string {
  const fee = getFee(type);
  const { totalCents } = calculateFeeBreakdown(fee.priceCents, 'bank', fee.currency);
  return `${fee.currency.toUpperCase()} ${(totalCents / 100).toFixed(2)} incl. GST`;
}
