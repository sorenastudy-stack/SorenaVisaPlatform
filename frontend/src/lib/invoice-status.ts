// Invoice states a client can still pay (mirrors the pay-link endpoint's guard).
//
// This lives in a PLAIN module, not in PaymentsView.tsx, deliberately.
//
// It used to be exported from that `'use client'` component and imported by the
// two server components that render it. In a production build Next.js turns a
// client module's exports into client REFERENCES, so on the server this was not
// an array — `PAYABLE_STATUSES.includes(...)` threw, the surrounding try/catch
// swallowed it, and the "Outstanding" section silently never rendered. It looked
// exactly like a client having no unpaid invoices.
//
// A value shared between server and client code must not be defined in a
// 'use client' file.
export const PAYABLE_STATUSES = ['SENT', 'OVERDUE'];
