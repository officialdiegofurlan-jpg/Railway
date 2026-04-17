# TherapyPortal Scraper

Headless browser service that extracts available appointment slots from TherapyPortal (TherapyNotes) portals.

## Why this exists

TherapyPortal uses ASP.NET session state + Cloudflare Bot Management. Direct HTTP calls to their internal AJAX endpoints fail without a real browser session. This service uses Playwright (headless Chrome) to properly initialize the session, then extracts the availability data.

## Endpoints

### `GET /` — Health check

### `POST /setup`
Returns practice info: clinicians, locations, appointment types.

```json
{ "portalUrl": "https://www.therapyportal.com/p/lightanxiety1/appointments/availability/" }
```

### `POST /availability`
Returns available time slots.

```json
{
  "portalUrl": "https://www.therapyportal.com/p/lightanxiety1/appointments/availability/",
  "startDate": "4/17/2026",
  "clinician": -1,
  "appointmentType": 0,
  "isExistingPatient": false,
  "location": -1
}
```

**appointmentType values:**
- `0` = Therapy Intake
- `1` = Therapy Session
- `2` = Psychiatry Intake
- `3` = Psychiatry Session

**Response:**
```json
{
  "success": true,
  "timeZone": "ET",
  "totalSlots": 12,
  "slots": [
    { "startTime": "2026-04-17T09:00:00", "clinicianId": 123, "locationId": 456 }
  ]
}
```

## Deploy to Railway

1. Push this repo to GitHub
2. Connect to Railway → New Project → Deploy from GitHub
3. Set env vars:
   - `API_KEY` (optional but recommended)
4. Railway auto-detects the Dockerfile

## Wire up in n8n

**Node: HTTP Request**
- Method: `POST`
- URL: `https://your-railway-app.railway.app/availability`
- Body (JSON):
  ```json
  {
    "portalUrl": "https://www.therapyportal.com/p/lightanxiety1/appointments/availability/",
    "startDate": "{{ $now.format('M/d/yyyy') }}"
  }
  ```
- Header: `x-api-key: YOUR_API_KEY`

The response `slots` array gives you all available times ready to process downstream.

## Local dev

```bash
npm install
npx playwright install chromium
node server.js
```

Test:
```bash
curl -X POST http://localhost:3000/availability \
  -H "Content-Type: application/json" \
  -d '{"portalUrl":"https://www.therapyportal.com/p/lightanxiety1/appointments/availability/"}'
```
