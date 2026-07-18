# PHASE-N — Per-portal naming/icon + section briefs

Two presentation-only changes. (1) Each staff portal is now named for its
function with a related icon, driven off the signed-in role from one place.
(2) Every section page across the portals gets a one-line brief under its title.
No access logic is touched.

## 1. What this PR does

**Part 1 — portal naming + icon.** The staff shell's top-left brand was always
"Sorena Visa / STAFF PORTAL". It now shows the role's portal name + a matching
icon (brand line "Sorena Visa" kept), driven from a single source
(`lib/portal-branding.tsx`). The legacy `/lia,/ops,/sales,/admin` shells
(`PortalLayout`) are aligned to the same names/icons.

**Part 2 — section briefs.** A muted one-line brief under the title on every
nav-level section page (list/overview) that lacked one, reusing the existing
subtitle pattern so it reads as intentional everywhere.

## 2. Part 1 — the role → name/icon map (one place)

`frontend/src/lib/portal-branding.tsx` → `portalBrand(role)`:

| Role(s) | Portal name | Icon (lucide) |
|---|---|---|
| OWNER / SUPER_ADMIN / ADMIN | **Admin Portal** | `ShieldCheck` |
| LIA | **Legal Portal** | `Scale` |
| CONSULTANT / CLIENT_CONSULTANT | **Consultant Portal** | `Handshake` |
| SUPPORT | **Support Portal** | `LifeBuoy` |
| FINANCE | **Finance Portal** | `Wallet` |
| OPERATIONS | **Operations Portal** | `Cog` |
| (fallback) | Staff Portal | `LayoutDashboard` |

`StaffSidebar` calls `portalBrand(me?.role)` and renders `<PortalIcon/>` +
"Sorena Visa" + the label — so an LIA sees **"Legal Portal"**, finance sees
"Finance Portal", etc. `PortalLayout` (legacy) keeps its own portal-keyed map,
updated to match (`lia: 'Legal Portal'`, `ops: 'Operations Portal'`, …) with
per-portal icons. The client shell already showed "Client Portal" — left as-is.

## 3. Part 2 — section briefs

The sweep found **75 section pages; 28 lacked a brief**. Briefs were added to the
**14 nav-level section pages** that lacked one; the other 14 are
intentionally excluded (see §7). Added (title → brief):
- **Cases** (shared staff+ops) → "Every client case — search, filter, and open one to see its stage, team, and documents."
- **Staff** (users) → "Everyone on the team — add members, set roles, and manage access."
- **Approvals** → "Owner sign-off queue for sensitive staff actions."
- **HR** → "Your leave requests, employment contract, and job description."
- **My Meetings** → "Your upcoming and past consultation sessions."
- **Bookings** → "Consultation bookings to run — mark each no-show, completed, or cancelled."
- **Training & News** → "Finance training guides and company news, in one place."
- **Operations Dashboard** (`/ops`) → upgraded the bare label to "Active cases by stage, what needs attention, and recent activity."
- **Sales Dashboard** (`/sales`) → "Your leads, pipeline, and consultations at a glance."
- **My wallet** → "Your Sorena credit — top-ups, refunds, and what you've spent."
- **Meetings** (student) → "Your booked sessions with the Sorena team."
- **Support tickets** (student) → "Your support conversations with the Sorena team."
- **New ticket** → "Tell us what you need help with and we'll get back to you."
- **Consultant meetings** → "Your scheduled client sessions."

Treatment is consistent: navy `#1e3a5f` title, a muted warm-gray brief
(`text-[#4A4A4A]/70`, `text-gray-400` on the ops dashboard to match its shell),
`mt-1` under the title, mobile-first. Pages that already had a brief were left
unchanged (`/staff/documents`, `/staff/leads`, `/lia/*`, `/ops/compliance`, etc.).

## 4. Files changed

- **New:** `frontend/src/lib/portal-branding.tsx`.
- **Branding:** `components/staff/shell/StaffSidebar.tsx`,
  `components/portal/PortalLayout.tsx`.
- **Briefs (14):** `staff/cases/CasesPageHeader`, `staff/users/StaffUsersPageHeader`,
  `staff/approvals/ApprovalsPageClient`, `staff/hr/HrPageClient`,
  `staff/meetings/StaffMeetingsClient`, `staff/bookings/StaffBookingsClient`,
  `app/staff/finance/training/page`, `app/ops/page`, `app/sales/page`,
  `portal/WalletClient`, `student/meetings/MeetingsList`, `tickets/TicketList`,
  `tickets/NewTicketForm`, `consultant/meetings/ConsultantMeetingsList`.
- **Test (gitignored):** `backend/scripts/test-portal-branding-briefs.ts`.

## 5. Configuration

None. Pure presentation; no env, schema, or endpoint change.

## 6. How to test

`scripts/test-portal-branding-briefs.ts` — **15/15**: `portalBrand` maps every
role to the right name+icon (LIA → "Legal Portal"/Scale, admin → Admin/ShieldCheck,
…); StaffSidebar imports+uses `portalBrand(me?.role)` and no longer hardcodes the
subtitle; PortalLayout aligned (lia → "Legal Portal" + icons); all 14 section
pages carry their brief in the muted treatment; **no "coming soon" strings
remain**; the branding fn has **no permission/gate logic**; and StaffSidebar's
**access gating (`n.roleGate` / `permissions[n.gate]`) is intact**.

`tsc` clean; `next build` clean.

## 7. Known limitations / deliberate exclusions

- **Record-detail `[id]` pages (13) got no static brief** — a specific case,
  lead, ticket, officer, agent, or scorecard is a *record instance*, not a nav
  section; each already shows the record's own context (a name + status/date/
  contact line). A generic "what this section does" brief doesn't fit a single
  record. `/portal/report` (a result artifact with a generated-on line),
  `/portal/case` (already carries stage-specific descriptions), and the LIA
  case-scoped views (`file-note`, `inz-data`, which show applicant/audit
  metadata) are excluded for the same reason.
- **Client/student briefs are English** (`/portal/wallet`, `/student/*`,
  consultant): the brief text is an inline English literal because the brief was
  to add **no new t() keys** (Persian frozen). On a Persian-toggled client page
  the title (a `t()` key) renders in Persian while the new brief stays English.
  This is the accepted tradeoff of the no-new-keys constraint — translate these
  when Persian unfreezes (add subtitle keys next to the title keys).

## 8. How to extend

- Rename a portal / change its icon: edit the single `portalBrand` switch in
  `lib/portal-branding.tsx` (staff shell) and, for the legacy shells,
  `PORTAL_TITLES` / `PORTAL_ICONS` in `PortalLayout.tsx`.
- Add a brief to a new section: put `<p className="mt-1 text-sm text-[#4A4A4A]/70">…</p>`
  directly under the `<h1>` (wrap title+brief in a `<div>` when the title sits
  next to a control).

## 9. Security

- **No access control touched.** Every change is a display string, an icon, or a
  `<p>`. The test asserts the branding helper contains no permission/role-gate
  logic and that StaffSidebar's nav gating (`roleGate` + `permissions[gate]`
  filter) is unchanged. `isFinance` (which selects the finance nav list — a
  presentation choice, not access) is preserved.
- The portal **name** is derived from the JWT role the shell already holds; it
  grants nothing — a user who somehow saw a different label would still be gated
  server-side on every endpoint.

## 10. Rollback procedure

- **Code:** revert the commit — the shells return to "Staff Portal" + logo-mark,
  and the added briefs disappear. No data/schema/endpoint change.
- **Frontend-only:** deploy/rollback independently of the backend; no migration.
