# DNS Inventory & Email Migration Plan

_Inventory captured: 25 Jun 2026. Status: inventory complete, no DNS changes made yet._

## Goal
Enable the platform to SEND transactional email (e.g. payment confirmations) from `noreply@sorenavisa.com` via Resend, while keeping the company's existing 18 mailboxes working. Long-term: make DNS independent of Wix by moving nameservers to Cloudflare, so leaving Wix later does not break email or the website.

## Current state
- Domain `sorenavisa.com` registered at a third-party registrar (expiry 31 Oct 2027), but **nameservers point to Wix**: `ns12.wixdns.net`, `ns13.wixdns.net`. Wix is therefore the live DNS source of truth.
- Team mailboxes are hosted in **cPanel (Dreamscape / Crazy Domains)**, NOT Wix.
- The platform currently tries to send via Resend, which is not yet verified — so no platform email is delivered.

## LIVE DNS records (must be recreated EXACTLY in Cloudflare)
| Type | Name | Value | Purpose |
|------|------|-------|---------|
| A | sorenavisa.com | 185.230.63.107 | Wix website |
| A | sorenavisa.com | 185.230.63.171 | Wix website |
| A | sorenavisa.com | 185.230.63.186 | Wix website |
| CNAME | www | www144.wixdns.net | www → Wix (CONFIRM via cPanel Zone Editor) |
| MX | sorenavisa.com | cp-wc11.per01.ds.network (priority 10) | Team mailboxes (cPanel). Also has IPv6 mail host 2405:3f00:a111:114::10 |
| TXT (SPF) | sorenavisa.com | v=spf1 a mx ip4:185.184.155.18 ip4:27.111.89.55 ~all | Sender authentication |
| TXT (DMARC) | _dmarc | v=DMARC1; p=none; rua=mailto:admission@sorenavisa.com | Email auth policy |

Root domain A-record TTL is 60 min (changes take up to 1 hour to propagate).

## Mailboxes to protect (cPanel)
admission@, support@, contact@, info@, finance@, sheilarose@, javier@, moradi.a@, a.tashvighi@, arjmand@, katsumi@, oscarbach@, phd@, pspk@, publishing@, insights@, noreply@ — plus any others in the cPanel account.

## Still to confirm BEFORE migrating (next session, from cPanel Zone Editor — the authoritative source)
1. Exact `www.sorenavisa.com` record.
2. Any DKIM record(s) the cPanel mail server uses (TXT under a `._domainkey` selector).
3. Any other subdomains (e.g. app, mail, autodiscover, autoconfig).

## Migration plan (next session — careful, do in order)
1. Open cPanel → Zone Editor for sorenavisa.com; export/screenshot the COMPLETE record list. Cross-check against the table above; capture DKIM + any subdomains.
2. Create a free Cloudflare account; add the domain `sorenavisa.com`. Cloudflare auto-imports records — verify every record above is present and correct; add any missing ones manually.
3. At the registrar, change nameservers from ns12/ns13.wixdns.net to the two Cloudflare nameservers Cloudflare provides.
4. Wait for propagation; verify the website still loads AND send/receive a test email on a real mailbox (e.g. admission@) to confirm mail still works.
5. Only after the above is confirmed: in Resend, add domain sorenavisa.com; add the DKIM/SPF/verification records Resend gives you into Cloudflare (the SPF line gets an added `include:` for Resend — do NOT replace the existing SPF, extend it).
6. Verify the domain in Resend.
7. In Railway, set EMAIL_FROM=noreply@sorenavisa.com; switch the platform's email code from the current path to the Resend/MailService path.
8. Trigger a real payment and confirm the client receives the confirmation email.

## Risk note
This is high-stakes because 18 live mailboxes depend on the MX/SPF/DKIM/DMARC records. A missed record = company-wide email outage. Do the nameserver switch deliberately, ideally at a low-traffic time, with the full cPanel zone export in hand.
