# DNS Inventory & Email Migration Plan

_Inventory captured: 25 Jun 2026. Status: inventory complete, no DNS changes made yet._

## Goal
Enable the platform to SEND transactional email (e.g. payment confirmations) from `noreply@sorenavisa.com` via Resend, while keeping the company's existing 18 mailboxes working. Long-term: make DNS independent of Wix by moving nameservers to Cloudflare, so leaving Wix later does not break email or the website.

## Current state
- Domain `sorenavisa.com` registered at a third-party registrar (expiry 31 Oct 2027), but **nameservers point to Wix**: `ns12.wixdns.net`, `ns13.wixdns.net`. Wix is therefore the live DNS source of truth.
- Team mailboxes are hosted in **cPanel (Dreamscape / Crazy Domains)**, NOT Wix.
- The platform currently tries to send via Resend, which is not yet verified — so no platform email is delivered.

## COMPLETE LIVE DNS inventory (authoritative — cPanel Zone Editor, 25 records, captured 25 Jun 2026)

> NOTE: The cPanel zone is the reference, but the live internet is served by Wix nameservers (ns12/ns13.wixdns.net), which OVERRIDE two records: the root website A record and www. Use the Wix-served values for those two; use cPanel for everything else.

### Website (live values come from Wix, NOT the cPanel 27.123.25.33 A record)
| Type | Name | Value |
|------|------|-------|
| A | sorenavisa.com | 185.230.63.107 |
| A | sorenavisa.com | 185.230.63.171 |
| A | sorenavisa.com | 185.230.63.186 |
| CNAME | www | cdn1.wixdns.net |

### Platform (Railway) — must preserve
| Type | Name | Value |
|------|------|-------|
| CNAME | app | l1r0ioqo.up.railway.app |
| TXT | _railway-verify.app | railway-verify=732f70a089d96b1e9cccdffcac2d37cfea2c0b6261b5875cfca8a3a993d99589 |
| TXT | _railway-verify.www | railway-verify=92ebe87447327da93fac3eb6d8173cacfb52ab5ba6499b7655430599aedb287b |

### Email — must preserve EXACTLY
| Type | Name | Value |
|------|------|-------|
| MX | sorenavisa.com | sorenavisa.com (priority 0) |
| TXT (SPF) | sorenavisa.com | v=spf1 +a +mx +ip4:185.184.155.18 ~all |
| TXT (DKIM) | default._domainkey | v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwJzHuL9P9n3ZyLS0LfFL6A+pjMIzxpJHaS+GKor9hm6EHbaxt/ecmtUWj9FmUA8CB44a3AMiWjs9W1AB1uJXPuNjlo0zUQGEbSth3+7hBjGxooNZcdWBvuqngvjyVYezM2rjcB1V9PHMbHvreUTk77Q0odpXlUssBDo49+ohzrZPi6NXGwYi1Jq6CVBUEpq4tT9Ibgiv839SrIaZLkXHkrmV2G1tlNDOdQD3q781OADKz9nn0z994+cggpgwPXDpGA4fKg8YH2d3PP7NvaUm3kzDp7GI2edah9CW7XBQveEAQdJ2FwiSiASxOzLWWmAX7nyK6sErJXtlLZBwE5ycWQIDAQAB; |

### cPanel / webmail service subdomains
All of these point to A `27.123.25.33` AND AAAA `2404:8280:a222:bbbb:bba1:11:ffff:ffff`:
mail (also a CNAME → sorenavisa.com), ftp, cpanel, cpcontacts, whm, cpcalendars, webdisk, webmail, ipv6, and the root sorenavisa.com AAAA.

## Mailboxes to protect (cPanel)
admission@, support@, contact@, info@, finance@, sheilarose@, javier@, moradi.a@, a.tashvighi@, arjmand@, katsumi@, oscarbach@, phd@, pspk@, publishing@, insights@, noreply@ — plus any others in the cPanel account.

## Inventory status
COMPLETE. All 25 records captured from the authoritative cPanel zone. The previously-missing DKIM record and Railway records are now included above. No further lookups needed before migration.

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
