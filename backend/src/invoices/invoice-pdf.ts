import PDFDocument from 'pdfkit';
import { BRAND } from '../scorecard/pdf/branding';
import { formatDateOnly } from '../scorecard/pdf/helpers';
import { INVOICE_COMPANY, TAX_INVOICE_HEADING } from './invoice-company';

// PR-TAX-INVOICE — the document a client can keep, forward or hand to a bank.
//
// Until now an invoice existed only as a row rendered as text on two web pages.
// A client had nothing to give a sponsor, nothing to file, and no sight of the
// GST the platform records against them.
//
// ONE DOCUMENT PER INVOICE, generated on demand and never stored. Its status is
// printed on its face and is true at the moment of download, because it is read
// from the row every time. A stored PDF would have to be invalidated on payment,
// on a Finance verification, on any correction — and the failure mode is a stale
// "you owe this" sitting in somebody's inbox after they have paid.
//
// English only, by decision: the rest of the platform mirrors Persian, a tax
// document does not.

export interface InvoicePdfData {
  invoiceNumber: string;
  description: string;
  /** Base price in cents, BEFORE GST. */
  baseCents: number;
  gstCents: number;
  /** base + GST — what is owed. */
  totalCents: number;
  /** Stripe's cut if they choose card. Shown as a note, never in the total. */
  cardFeeCents: number;
  cardTotalCents: number;
  currency: string;
  status: string;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  client: { fullName: string; email: string | null };
  bank: {
    bankName: string;
    bankAddress: string;
    accountName: string;
    accountNumber: string;
    swift: string;
  };
}

const money = (cents: number, currency: string) =>
  `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;

/** PAID is settled; anything else is still owed. Colour follows meaning. */
function statusChip(status: string): { label: string; color: string } {
  switch (status) {
    case 'PAID':      return { label: 'PAID',      color: BRAND.COLORS.PALETTE.EMERALD };
    case 'CANCELLED': return { label: 'CANCELLED', color: BRAND.COLORS.MUTED };
    case 'REFUNDED':  return { label: 'REFUNDED',  color: BRAND.COLORS.MUTED };
    case 'OVERDUE':   return { label: 'OVERDUE',   color: BRAND.COLORS.PALETTE.RED };
    default:          return { label: 'UNPAID',    color: BRAND.COLORS.PALETTE.AMBER };
  }
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: BRAND.PAGE.SIZE,
      margins: {
        top: BRAND.PAGE.MARGIN,
        bottom: BRAND.PAGE.MARGIN,
        left: BRAND.PAGE.MARGIN,
        right: BRAND.PAGE.MARGIN,
      },
      info: { Title: `Tax Invoice ${data.invoiceNumber}`, Author: INVOICE_COMPANY.legalName },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, margins } = doc.page;
    const contentW = width - margins.left - margins.right;
    const right = width - margins.right;
    const cur = data.currency;

    // ── Header band ──────────────────────────────────────────────────────────
    doc.rect(0, 0, width, 96).fill(BRAND.COLORS.NAVY);
    doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(17);
    doc.text(INVOICE_COMPANY.tradingName, margins.left, 28, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BODY).fontSize(8.5);
    doc.text(INVOICE_COMPANY.legalName.toUpperCase(), margins.left, 50, { lineBreak: false });

    // The heading a tax invoice must carry, right-aligned opposite the name.
    doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(15);
    const hW = doc.widthOfString(TAX_INVOICE_HEADING);
    doc.text(TAX_INVOICE_HEADING, right - hW, 30, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BODY).fontSize(8.5);
    const nW = doc.widthOfString(data.invoiceNumber);
    doc.text(data.invoiceNumber, right - nW, 52, { lineBreak: false });

    doc.rect(0, 96, width, 3).fill(BRAND.COLORS.GOLD);

    // ── Status ───────────────────────────────────────────────────────────────
    // On the face of the document, because this is the one document per invoice
    // and it has to say what is true right now.
    const chip = statusChip(data.status);
    let y = 122;
    doc.roundedRect(margins.left, y, 78, 22, 4).fill(chip.color);
    doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(10);
    const cW = doc.widthOfString(chip.label);
    doc.text(chip.label, margins.left + (78 - cW) / 2, y + 6, { lineBreak: false });

    if (data.status === 'PAID' && data.paidAt) {
      doc.fillColor(BRAND.COLORS.PALETTE.EMERALD).font(BRAND.FONTS.BODY).fontSize(9);
      doc.text(`Paid ${formatDateOnly(data.paidAt)} — no payment is due.`,
        margins.left + 90, y + 7, { lineBreak: false });
    }

    // ── Parties ──────────────────────────────────────────────────────────────
    y += 44;
    const colW = contentW / 2 - 10;

    doc.fillColor(BRAND.COLORS.MUTED).font(BRAND.FONTS.BOLD).fontSize(7.5);
    doc.text('FROM', margins.left, y, { lineBreak: false });
    doc.text('BILLED TO', margins.left + colW + 20, y, { lineBreak: false });

    doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10);
    doc.text(INVOICE_COMPANY.legalName, margins.left, y + 13, { width: colW });
    doc.text(data.client.fullName, margins.left + colW + 20, y + 13, { width: colW });

    doc.fillColor(BRAND.COLORS.BODY).font(BRAND.FONTS.BODY).fontSize(8.5);
    const fromLines = [
      `GST no. ${INVOICE_COMPANY.gstNumber}`,
      `NZBN ${INVOICE_COMPANY.nzbn}`,
      INVOICE_COMPANY.contactEmail,
      INVOICE_COMPANY.contactPhone,
    ];
    doc.text(fromLines.join('\n'), margins.left, y + 28, { width: colW });
    if (data.client.email) {
      doc.text(data.client.email, margins.left + colW + 20, y + 28, { width: colW });
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    y += 92;
    doc.fillColor(BRAND.COLORS.MUTED).font(BRAND.FONTS.BODY).fontSize(8.5);
    const dates = [
      data.issuedAt ? `Issued: ${formatDateOnly(data.issuedAt)}` : null,
      data.dueDate ? `Due: ${formatDateOnly(data.dueDate)}` : null,
    ].filter(Boolean).join('     ');
    if (dates) doc.text(dates, margins.left, y, { lineBreak: false });

    // ── Line items ───────────────────────────────────────────────────────────
    y += 24;
    doc.rect(margins.left, y, contentW, 22).fill(BRAND.COLORS.NAVY);
    doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(8.5);
    doc.text('DESCRIPTION', margins.left + 10, y + 7, { lineBreak: false });
    const amtHdr = 'AMOUNT';
    doc.text(amtHdr, right - 10 - doc.widthOfString(amtHdr), y + 7, { lineBreak: false });

    y += 22;
    doc.rect(margins.left, y, contentW, 26).fill(BRAND.COLORS.PALETTE.WHITE);
    doc.fillColor(BRAND.COLORS.BODY).font(BRAND.FONTS.BODY).fontSize(10);
    doc.text(data.description, margins.left + 10, y + 8, { lineBreak: false });
    const base = money(data.baseCents, cur);
    doc.text(base, right - 10 - doc.widthOfString(base), y + 8, { lineBreak: false });

    // ── Totals ───────────────────────────────────────────────────────────────
    y += 34;
    const labelX = right - 190;
    const row = (label: string, value: string, bold = false, color: string = BRAND.COLORS.BODY) => {
      doc.fillColor(color)
         .font(bold ? BRAND.FONTS.BOLD : BRAND.FONTS.BODY)
         .fontSize(bold ? 11 : 9.5);
      doc.text(label, labelX, y, { lineBreak: false });
      doc.text(value, right - doc.widthOfString(value), y, { lineBreak: false });
      y += bold ? 20 : 16;
    };

    row('Subtotal (excl. GST)', money(data.baseCents, cur));
    row(`GST 15%`, money(data.gstCents, cur));
    doc.moveTo(labelX, y + 2).lineTo(right, y + 2)
       .lineWidth(0.8).strokeColor(BRAND.COLORS.GOLD).stroke();
    y += 10;
    // Wording follows status. "Total due" on an invoice somebody has already
    // paid is the exact stale-document failure the one-document design exists
    // to avoid — the document changes state, so its words have to change too.
    const owing = !['PAID', 'CANCELLED', 'REFUNDED'].includes(data.status);
    row(owing ? 'Total due' : 'Total', money(data.totalCents, cur), true, BRAND.COLORS.NAVY);

    if (owing) {
      // The card fee is a payment-method note, never part of what is owed — an
      // invoice settled by transfer must not carry a fee the client never paid.
      doc.fillColor(BRAND.COLORS.MUTED).font(BRAND.FONTS.BODY).fontSize(8);
      doc.text(
        `Paying by card adds a ${money(data.cardFeeCents, cur)} processing fee `
        + `(${money(data.cardTotalCents, cur)} total). Bank transfer has no fee.`,
        // Anchored to the right margin: the box starts here and ends exactly at
        // `right`, so a longer currency or fee can never run off the page.
        right - 300, y, { width: 300, align: 'right' as const },
      );
    }

    // ── Payment instructions ─────────────────────────────────────────────────
    // Only while something is owed. Telling a client how to pay an invoice they
    // have already settled is how a second payment happens.
    if (owing) {
      y += 46;
      doc.rect(margins.left, y, contentW, 3).fill(BRAND.COLORS.GOLD);
      y += 14;
      doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10);
      doc.text('Payment by bank transfer', margins.left, y, { lineBreak: false });
      y += 16;
      doc.fillColor(BRAND.COLORS.BODY).font(BRAND.FONTS.BODY).fontSize(9);
      // Read live from platform settings — never a copy. The account an admin
      // edits is the account this prints.
      const bankLines = [
        `Bank: ${data.bank.bankName}`,
        `Account name: ${data.bank.accountName}`,
        `Account number: ${data.bank.accountNumber}`,
        `SWIFT: ${data.bank.swift}`,
        `Reference: ${data.invoiceNumber}`,
      ];
      doc.text(bankLines.join('\n'), margins.left, y, { width: contentW });
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = doc.page.height - margins.bottom - 34;
    doc.moveTo(margins.left, footerY - 10).lineTo(right, footerY - 10)
       .lineWidth(0.6).strokeColor(BRAND.COLORS.PALETTE.GRAYLIGHT).stroke();
    doc.fillColor(BRAND.COLORS.MUTED).font(BRAND.FONTS.BODY).fontSize(7.5);
    doc.text(INVOICE_COMPANY.footerLine, margins.left, footerY, { width: contentW });

    doc.end();
  });
}
