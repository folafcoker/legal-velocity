# Legal Velocity — Elaine Approval Turnaround

Live dashboard tracking how long contracts spend with Elaine during the internal approval loop. Updates automatically via Juro webhooks.

**Live:** https://legal-velocity.vercel.app

---

## What it does

- Shows every contract sent to Elaine for approval, with per-turn breakdown (sent → returned, days taken)
- Color-coded turnaround times: green ≤3d, amber ≤7d, red >7d
- **Live feed** — approval activity from the last 24 hours, auto-refreshes every 60s
- **Slack notifications** — posts to `#x-velocity-legal-pulse` whenever a contract lands with Elaine, including Priority Level, Internal Status, Owner and a direct Juro link
- Historical seed data is always visible; live webhook data overlays on top as it arrives

---

## Architecture

```
Juro (contract.approval_requested / contract.fully_approved)
    ↓  webhook POST
/api/webhook          ← parses event, updates Redis, fires Slack
    ↓
Upstash Redis         ← stores live contract turns + feed events
    ↓
/api/contracts        ← serves merged contract data to the dashboard
/api/feed             ← serves last 24h activity feed (max 5 items)
    ↓
index.html            ← fetches on load, merges with seed data, shows LIVE badge
```

### Juro webhook payload shape

Juro sends events in this structure (confirmed from live payloads):

```json
{
  "event": {
    "type": "contract.approval_requested",
    "by":   { "email": "elaine@granola.so", "name": "Elaine Foreman" }
  },
  "contract": {
    "id":          "69e23661d4c650606c10958d",
    "name":        "Acme Corp - Enterprise Order Form.docx",
    "template":    { "name": "Enterprise Order Form with Platform Terms" },
    "owner":       { "name": "Ryan Francis", "username": "ryan@granola.so" },
    "fields":      [ { "title": "Priority Level", "value": "P0 / Top Priority" }, ... ],
    "internalUrl": "https://app.juro.com/sign/{id}",
    "updatedDate": "2026-04-17T15:14:15.636Z"
  }
}
```

---

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/webhook` | POST | Receives Juro webhook events |
| `/api/contracts` | GET | Returns live contracts from Redis |
| `/api/feed` | GET | Returns last 5 approval events from the last 24h |

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Required in Vercel:

| Variable | Purpose |
|---|---|
| `KV_REST_API_URL` | Upstash Redis — injected automatically by Vercel integration |
| `KV_REST_API_TOKEN` | Upstash Redis — injected automatically by Vercel integration |
| `SLACK_WEBHOOK_URL` | Incoming webhook for `#x-velocity-legal-pulse` |
| `JURO_API_KEY` | Optional — not currently used (smartfields come in the webhook payload) |
| `JURO_WEBHOOK_SECRET` | Optional — validates Juro webhook signature header |

### Local development

```bash
npm install
vercel env pull .env.local   # pulls production env vars locally
vercel dev                   # runs functions + static files locally
```

---

## Juro webhook setup

In Juro → Settings → Webhooks:
- **URL:** `https://legal-velocity.vercel.app/api/webhook`
- **Triggers:** Contract sent for approval, Contract fully approved

---

## Folder contents

```
legal-velocity/
├── index.html          ← dashboard (seed data + live overlay)
├── api/
│   ├── webhook.js      ← Juro webhook receiver
│   ├── contracts.js    ← live contracts API
│   └── feed.js         ← recent activity feed API
├── .env.example        ← required environment variables
├── DATA_MODEL.md       ← turn data structure + Juro event mapping
├── NEXT_STEPS.md       ← backlog and status
├── parse_juro.py       ← converts Juro activity export → JS (manual refresh)
└── build_contracts.py  ← normalises contract names for display
```
