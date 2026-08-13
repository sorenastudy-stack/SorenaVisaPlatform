// PR-TAX-INVOICE — the legal identity that has to appear on a NZ tax invoice.
//
// A GST-registered supplier must state its name and GST number on any document
// it calls a tax invoice. These are facts about the company, not configuration
// somebody tunes, so they live in code where a change is reviewable — unlike
// the BANK details, which an admin edits in platform settings and which the
// renderer therefore reads live rather than copying here.
//
// (That distinction is the lesson of the chatbot fix earlier today: it carried
// its own copy of the account number beside the admin-editable one, and would
// have gone on quoting a stale account forever.)

export const INVOICE_COMPANY = {
  legalName: 'Sorena Study Limited',
  tradingName: 'Sorena Visa',

  /** NZ GST registration. Required on the face of a tax invoice. */
  gstNumber: '131454295',
  /** NZ Business Number — not legally required here, included for the record. */
  nzbn: '942904796194',

  contactName: 'Yashua Arjmand',
  contactPhone: '+64 9 363 2060',
  contactEmail: 'accounting@sorenavisa.com',

  /** Verbatim, as supplied. */
  footerLine:
    'If you have any questions concerning this invoice, use the following contact information: '
    + 'Yashua Arjmand, +64 9 363 2060, accounting@sorenavisa.com. Thank you for your business!',
} as const;

/**
 * The heading a NZ tax invoice must carry.
 *
 * "TAX INVOICE" is the wording IRD expects when GST is being charged and
 * claimed. It is a constant rather than a prop so no caller can render this
 * document under a different name.
 */
export const TAX_INVOICE_HEADING = 'TAX INVOICE';
