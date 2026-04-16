# Legal Velocity — Elaine Approval Turnaround

Live dashboard tracking how long contracts spend with Elaine during the internal approval loop. Updates automatically via Juro webhooks.

**Live:** https://legal-velocity.vercel.app

---

## What it does

- Shows every contract sent to Elaine for approval, with per-turn breakdown (sent → returned, days taken)
- Color-coded turnaround times: green ≤3d, amber ≤7d, red >7d
- **Live feed** — approval activity from the last 24 hours, auto-refreshes every 60s
- **Slack notifications** — posts to `#x-velocity-legal-pulse` whenever a contract lands with Elaine
- Historical seed data is always visible; live webhook data overlays on top as it arrives

---

## Architecture

```
Juro (contract.sent_for_approval / contract.fully_approved)
    ↓  webhook POST
/api/webhook          ← processes event, updates Redis, fires Slack
    ↓
Upstash Redis         ← stores live contract turns + feed events
    ↓
/api/contracts        ← serves merged contract data to the dashboard
/api/feed             ← serves last 24h activity feed (max 5 items)
    ↓
index.html            ← dashboard fetches on load, merges with seed data
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
| `JURO_API_KEY` | Enriches Slack notifications with smartfield data (Priority, Owner, Status) |
| `JURO_WEBHOOK_SECRET` | Optional — validates Juro webhook signature |

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
├── NEXT_STEPS.md       ← backlog and testing notes
├── parse_juro.py       ← converts Juro activity export → JS (manual refresh)
└── build_contracts.py  ← normalises contract names for display
```
