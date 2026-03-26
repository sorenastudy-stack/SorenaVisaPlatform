# Sorena Visa Platform — Acquisition Domain MVP

A production-ready lead acquisition system for Sorena Visa NZ, handling visitor tracking, lead capture, email verification, consent recording, and handoff preparation.

---

## Project Structure

```
SorenaVisaPlatform/
├── backend/          NestJS + Prisma + PostgreSQL API
├── frontend/         Next.js 14 landing page + lead form
├── .env.example      Root environment documentation
└── README.md
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your database URL and settings

npm install
npm run prisma:generate
npm run prisma:migrate   # creates tables
npm run start:dev        # runs on http://localhost:3001
```

### 2. Frontend Setup

```bash
cd frontend
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001

npm install
npm run dev              # runs on http://localhost:3000
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/acquisition/visitors` | Public | Register a visitor session |
| POST | `/acquisition/events` | Public | Track a visitor event |
| POST | `/acquisition/leads` | Public | Submit a lead capture |
| GET | `/acquisition/verify-email?token=` | Public | Verify email address |
| GET | `/acquisition/leads/:id` | API Key | Retrieve lead details |
| POST | `/acquisition/handoffs/:id` | API Key | Create lead handoff |
| GET | `/acquisition/handoffs/:id` | API Key | Retrieve handoff details |

Protected endpoints require `Authorization: Bearer <HANDOFF_API_KEY>`.

---

## Sample Requests

### Create a Visitor
```bash
curl -X POST http://localhost:3001/acquisition/visitors \
  -H "Content-Type: application/json" \
  -d '{
    "country": "NZ",
    "utmSource": "google",
    "utmMedium": "cpc",
    "utmCampaign": "nz-student-visa"
  }'
```

### Submit a Lead
```bash
curl -X POST http://localhost:3001/acquisition/leads \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Sarah Johnson",
    "email": "sarah@example.com",
    "phone": "+6421000000",
    "destination": "NZ",
    "studyLevel": "postgraduate",
    "preferredLanguage": "English",
    "privacyConsent": true,
    "marketingConsent": false,
    "utmSource": "google",
    "website": ""
  }'
```

Response (email provided):
```json
{
  "id": "clxxx...",
  "status": "UNVERIFIED",
  "emailVerificationRequired": true,
  "message": "Please check your email to verify your details."
}
```

### Verify Email
```bash
curl "http://localhost:3001/acquisition/verify-email?token=<64-char-hex-token>"
```

### Get Lead (API Key required)
```bash
curl http://localhost:3001/acquisition/leads/<lead-id> \
  -H "Authorization: Bearer <HANDOFF_API_KEY>"
```

### Create Handoff (API Key required)
```bash
curl -X POST http://localhost:3001/acquisition/handoffs/<lead-id> \
  -H "Authorization: Bearer <HANDOFF_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "notes": "High-priority student visa enquiry" }'
```

---

## Business Rules

- **At least one contact method** (email, phone, or WhatsApp) is required per lead
- **Privacy consent** must be explicitly set to `true`
- **Email verification** is mandatory if email is provided — lead remains `UNVERIFIED` until verified
- **Duplicate detection** — same email or phone within 24 hours returns existing lead silently
- **Handoff readiness** — email must be verified before a handoff can be created
- **Destination** — currently restricted to `NZ` only (extensible via the `destination` field)

---

## Security Features

| Feature | Implementation |
|---------|---------------|
| Rate limiting | 5 req/min on `POST /leads`, 120 req/min on `POST /events` |
| Input validation | `class-validator` DTOs with whitelist + forbidNonWhitelisted |
| Sanitization | HTML entity escaping on all string inputs |
| Honeypot | `website` field — bots fill it in, silently discarded |
| Token security | `crypto.randomBytes(32)` stored as SHA-256 hash, 24h expiry |
| API key auth | Timing-safe comparison via `crypto.timingSafeEqual` |
| Error safety | Global exception filter — no stack traces or DB structure exposed |
| CORS | Whitelist-based origin validation |
| Security headers | Helmet.js |

---

## Email Verification Flow

1. Lead submits form with email → token generated → SHA-256 hash stored in DB → plain token emailed
2. User clicks link → `GET /acquisition/verify-email?token=<plain>`
3. Backend hashes token, looks up hash in DB, checks expiry
4. On success → lead status updated to `VERIFIED`
5. In development — verification URL is logged to console (no SMTP needed)

---

## Environment Variables

### Backend (`backend/.env`)
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/sorena_visa"
HANDOFF_API_KEY="your-long-random-secret"
NODE_ENV="development"
PORT=3001
FRONTEND_URL="http://localhost:3000"
ALLOWED_ORIGINS="http://localhost:3000"
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT=587
EMAIL_USER="your@email.com"
EMAIL_PASS="your-app-password"
EMAIL_FROM="Sorena Visa <noreply@sorenavisa.co.nz>"
```

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Data Models

| Model | Purpose |
|-------|---------|
| `Visitor` | Anonymous session tracking with UTM attribution |
| `AcquisitionEvent` | Visitor behaviour events (page views, clicks) |
| `LeadCapture` | Core lead record with contact and status |
| `LeadSourceAttribution` | UTM/referrer data linked to lead |
| `ConsentRecord` | Immutable consent audit trail (privacy + marketing) |
| `LeadHandoff` | Downstream handoff payload with status tracking |
| `EmailVerification` | Token hash + expiry for email verification |

---

## Lead Status Lifecycle

```
PENDING → UNVERIFIED (email submitted, awaiting verification)
       → VERIFIED    (no email, or email verified)
UNVERIFIED → VERIFIED → HANDOFF_READY
Any status → DISQUALIFIED (manual disqualification)
```
