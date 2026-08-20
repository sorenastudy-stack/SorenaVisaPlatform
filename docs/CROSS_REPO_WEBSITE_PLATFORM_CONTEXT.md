# Sorena Visa Website and Platform — Cross-Repository Context

**Last verified:** 21 August 2026 (Pacific/Auckland)

## Purpose

Sorena Visa operates two separate applications in two separate repositories. Any readiness assessment, integration review, SEO review, conversion-journey review, or deployment plan must inspect both repositories before reaching a conclusion.

Do not infer that the public website is missing from documents that describe only the Sorena Study platform repository. Historical Wix documents are migration records and are not the current website architecture.

## Repository and service map

| System | Repository | Hosting | Primary responsibility |
|---|---|---|---|
| Public Sorena Visa website | [sorenastudy-stack/sorena-visa-website](https://github.com/sorenastudy-stack/sorena-visa-website) | Vercel | Public pages, localized landing pages, Knowledge Hub, SEO, consent UI and public conversion journeys |
| Sorena Study platform | [sorenastudy-stack/SorenaVisaPlatform](https://github.com/sorenastudy-stack/SorenaVisaPlatform) | Railway and Vercel | CRM, contacts, leads, Scorecard, webinar records, email lifecycle and authenticated portals |
| DNS | Cloudflare | Cloudflare | Authoritative DNS for the Sorena Visa domain |

The public website repository is an existing Next.js application. The platform repository's frontend is the authenticated Sorena Study application and must not be mistaken for the public marketing website.

## Current integration boundary

- The two applications remain independently deployable and independently reversible.
- Public website conversion actions communicate with Sorena Study through server-side API calls.
- The public website must not connect directly to the Sorena Study database.
- Secrets and private service configuration must remain in provider-managed environment settings and must never appear in code or documentation.
- Sorena Study remains the system of record for customer, lead, Scorecard and webinar operational data.
- Website-owned content remains in the website repository until a separate CMS decision is approved.

## Verified current state

As of 21 August 2026:

- The website repository is connected to a production Vercel project.
- The public domain is intentionally held behind a maintenance response until launch approval.
- The website contains the marketing site, localized landing pages, Knowledge Hub, technical SEO files, privacy/consent UI and a webinar registration journey.
- The webinar journey has been tested end to end from the website through Sorena Study, including registration, confirmation email, calendar addition and meeting-link access.
- The website Admin area is a visual prototype and must not be treated as a live operational dashboard.

## Assessment correction

A readiness assessment that inspects only `SorenaVisaPlatform` cannot determine whether the public website exists or is launch-ready. The two-repository topology above is mandatory context for future audits.

The historical conclusion that “no website codebase exists” is not current. Future assessments must distinguish between:

1. readiness of the public marketing MVP;
2. readiness of the Sorena Study platform;
3. readiness of later integrated capabilities such as live website administration, CMS and advanced operations.

## Change coordination

When a change affects both applications:

1. Inspect the current default branch of both repositories.
2. Document the API behaviour and data ownership without including secrets.
3. Prepare linked changes in both repositories when both sides are affected.
4. Verify both the HTTP result and the downstream user outcome.
5. Preserve separate deployment and rollback paths.
6. Update this document in both repositories when the system boundary changes.

## Current-state evidence order

Use the following precedence:

1. Verified production behaviour
2. Current default-branch code in both repositories
3. Current provider deployment state
4. This cross-repository context
5. Historical migration and readiness documents
