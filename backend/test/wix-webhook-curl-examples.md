# Wix lead-capture webhook — local curl examples (PR-WIX-1)

The webhook lives at `POST /api/webhooks/wix/lead-capture` and
expects an `x-sorena-webhook-secret` header. The secret value
lives in `backend/.env` under `WIX_WEBHOOK_SECRET`. Pull it with:

```bash
grep '^WIX_WEBHOOK_SECRET=' .env | sed -E 's/^[^=]+=//; s/"//g'
```

In the examples below, replace `YOUR_SECRET` with that value and
`HOST` with whichever target you're hitting:

| Target | HOST |
|---|---|
| Local backend on default port | `localhost:3001` |
| ngrok tunnel during integration testing | `https://<your-subdomain>.ngrok-free.dev` |
| Production (after deploy) | The Vercel backend domain — set Wix to use that URL |

## 1. Canonical payload (the shape Wix *should* send)

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: YOUR_SECRET" \
  --data-binary @test/wix-sample-payload.json
```

Expected response:

```json
{ "status": "created", "leadId": "<cuid>" }
```

Re-running the exact same command should return:

```json
{ "status": "duplicate", "leadId": "<same-cuid>" }
```

because `externalSubmissionId` is computed from `email + submittedAt + secret`.

## 2. Flat-fields shape (no `fields` envelope)

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: YOUR_SECRET" \
  -d '{
    "fullName": "Aisha Khalili",
    "email": "aisha.khalili@example.com",
    "phone": "+98 21 1234 5678",
    "countryOfResidence": "NZ",
    "currentEducationLevel": "Master degree",
    "submittedAt": "2026-05-22T12:00:00Z"
  }'
```

## 3. Wix Forms-style with field labels (varied casing / underscores)

The normaliser collapses `"Full Name"`, `"full_name"`, `"FULL-NAME"`,
`"fullname"`, `"firstAndLastName"`, etc. to the same canonical field:

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: YOUR_SECRET" \
  -d '{
    "submissions": [
      { "name": "Full Name", "value": "Mojgan Nazari" },
      { "name": "Email Address", "value": "mojgan@example.com" },
      { "name": "Mobile Number", "value": "+98 935 555 0001" },
      { "name": "Country", "value": "United Kingdom" },
      { "name": "Highest qualification", "value": "Diploma" }
    ],
    "submittedAt": "2026-05-22T13:00:00Z"
  }'
```

## 4. Unresolvable country falls back to `countryRaw`

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: YOUR_SECRET" \
  -d '{
    "fullName": "Test Aotearoa",
    "email": "aotearoa@example.com",
    "countryOfResidence": "Middle Earth",
    "submittedAt": "2026-05-22T14:00:00Z"
  }'
```

Result: a Lead is still created (200 `created`); `countryOfResidence`
on the linked Contact stays null and `Lead.countryRaw` = `"Middle Earth"`.

## 5. Missing email → 400

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: YOUR_SECRET" \
  -d '{ "fullName": "No Email", "submittedAt": "2026-05-22T15:00:00Z" }'
```

```json
{ "status": "error", "error": "INVALID_PAYLOAD", "message": "Missing or invalid `email`" }
```

## 6. Bad secret → 401

```bash
curl.exe -X POST http://HOST/api/webhooks/wix/lead-capture \
  -H "Content-Type: application/json" \
  -H "x-sorena-webhook-secret: not-the-real-secret" \
  -d '{ "fullName": "Bad", "email": "bad@example.com" }'
```

```json
{ "status": "error", "error": "INVALID_SECRET" }
```

## 7. Verifying the lead landed in the DB

```bash
PGPASSWORD=sorena2026 psql -h localhost -U postgres -d sorenavisaplatform -c "
  SELECT l.id, c.\"fullName\", c.email, l.\"sourceChannel\", l.\"currentEducationLevel\",
         l.\"externalSubmissionId\", l.\"countryRaw\", c.\"countryOfResidence\"
    FROM leads l
    JOIN contacts c ON c.id = l.\"contactId\"
   WHERE l.\"sourceChannel\" = 'WIX_LEAD_CAPTURE'
   ORDER BY l.\"createdAt\" DESC
   LIMIT 5;
"
```
