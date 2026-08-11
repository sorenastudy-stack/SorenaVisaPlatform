// PR-ROLES-REFERENCE — what each role is FOR, in plain English.
//
// This is the one part of the Roles & Access page that is authored rather than
// derived. No decorator records intent, so intent has to be written down — but
// it is kept in its own file, and the page labels it as a description, so
// nobody mistakes it for what the system enforces. The route lists beside it
// are read from live metadata and always win as the statement of fact.
//
// Sourced from the codebase, not invented: the schema comments on UserRole, the
// i18n staff.roles labels (the canonical display names), PHASE_15 on admission
// allocation, and the role gates themselves.

export const ROLE_RESPONSIBILITIES: Record<string, string> = {
  OWNER:
    'The business owner. Holds every permission in the platform and is the only role that can approve owner-approval requests — the destructive or sensitive actions other admins have to enqueue rather than perform. Sees every pipeline, case and ledger without restriction.',

  SUPER_ADMIN:
    'Full technical administrator. Matches OWNER almost everywhere and exists so platform administration does not require the owner’s account. Sensitive actions it initiates are queued for OWNER approval rather than taking effect immediately.',

  ADMIN:
    'Day-to-day operational administrator. Manages staff, assignments and configuration, and has oversight of the whole lead funnel rather than a personal queue. Does not hold the money-lifecycle permissions that sit with FINANCE.',

  SALES:
    'Works the top of the funnel: new leads, qualification and conversion. Sees the leads assigned to them and the commissions arising from those leads — not the whole pipeline or the whole ledger. Read-only on commissions; the money lifecycle stays with FINANCE.',

  CONSULTANT:
    'Admission Officer. Owns a client’s admission work — programme choice, application assembly and submission to institutions — and is allocated to cases by language and workload. Distinct from Client Officer despite the similar name.',

  CLIENT_CONSULTANT:
    'Client Officer. Owns the client relationship end to end, from eligibility through to the visa result, and is the person the client deals with across the whole journey. Distinct from the Admission Officer, who handles the application itself.',

  LIA:
    'Licensed Immigration Adviser. The only role permitted to give immigration advice, review red-flagged cases, and sign engagement letters as adviser. Also owns visa document review and the expiring-visa queue.',

  FINANCE:
    'The accountant. Confirms incoming payments, runs the commission lifecycle (confirm → invoice → paid), sets the exchange rate used to state GST, and has oversight of the funnel for reconciliation. Does not perform admission or immigration work.',

  SUPPORT:
    'Front-line support. Handles client tickets and questions and can see what a client sees, without the case-ownership or money permissions of the specialist roles.',

  OPERATIONS:
    'Legacy operations role, being retired. Its pages were folded into the Owner dashboard; it is kept in the enum so existing rows and historic audit records stay valid rather than being rewritten.',

  AGENT:
    'External recruitment partner. Introduces clients and tracks their own referrals. Has no access to internal staff surfaces.',

  STUDENT:
    'A paying client. Reaches only their own portal — their case, documents, invoices and messages — and never any staff surface.',

  LEAD:
    'Someone who has submitted the readiness assessment but has not yet paid for an account. Sits between an anonymous visitor and a client, and can see only their own assessment result.',
};
