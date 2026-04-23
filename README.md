# Legal Velocity — Elaine Approval Turnaround

Live dashboard tracking how long contracts spend with the legal team (Elaine Foreman + Julie Plisinski) during the internal approval loop.

**Live:** https://legal-velocity.vercel.app

---

## What it does

- Shows every contract sent to the legal team for approval, with per-turn breakdown (sent → returned, business days taken)
- Tracks both Elaine and Julie as legal reviewers — Elaine↔Julie internal routing does not count as a separate turn
- Color-coded turnaround times: green ≤1d, amber ≤2d, red >2d (48h SLA)
- **Live feed** — approval activity from the last 24 hours, auto-refreshes every 60s
- **SLA breach view** — `/breach` shows every contract that exceeded the 48h threshold
- **History log** — full audit trail of every approval turn since Nov 2025
- **Slack notifications** — posts to `#x-velocity-legal-pulse` whenever a contract lands with legal, including Priority Level, Internal Status, Owner and a direct Juro link

---

## Architecture

```
Juro (contract.approval_requested / contract.fully_approved)
    ├── webhook POST (real-time, precise timestamps)
    │       ↓
    │   /api/webhook        ← parses event, updates Redis, fires Slack
    │
    └── Juro REST API (polled every 10 minutes via Vercel cron)
            ↓
        /api/sync-juro      ← fetches all contracts, detects legal-team turns,
                               writes to history log + contract store

Upstash Redis
    ├── juro:contract:{id}      ← current contract + turns (from API sync)
    ├── contract:{id}           ← contract + turns (from webhook, real-time)
    ├── juro:event_log          ← sorted set: full history of every turn
    ├── juro:event_dedup        ← set: prevents duplicate history entries
    ├── juro:state:{id}         ← last-seen approval state per contract
    └── feed                    ← list: last 50 recent activity events

/api/contracts    ← merges Juro API + webhook sources, serves to dashboard
/api/feed         ← last 24h activity (max 5 items)
/api/history      ← full turn history with business-day durations
/api/sync-juro    ← sync endpoint (also called by cron every 10 min)

index.html        ← main dashboard (seed data + live overlay)
breach.html       ← SLA breach analysis
```

### Turn definition

A **turn** is the period a contract spends within the legal team:
- **Opens** when a contract is sent to Elaine or Julie from outside the legal team
- **Closes** when Elaine or Julie sends it back to anyone outside the legal team
- **Ignored** if the contract moves between Elaine and Julie (internal routing)

SLA threshold: **48 business hours** (weekends + US federal holidays excluded).

---

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/webhook` | POST | Receives Juro webhook events (real-time) |
| `/api/sync-juro` | GET/POST | Syncs Juro API → Redis; `?full=true` rescans all contracts |
| `/api/contracts` | GET | Merged live contract data |
| `/api/feed` | GET | Last 5 approval events from the last 24h |
| `/api/history` | GET | Full turn history; supports `?from=YYYY-MM-DD&to=YYYY-MM-DD` |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `KV_REST_API_URL` | Upstash Redis URL (auto-injected by Vercel integration) |
| `KV_REST_API_TOKEN` | Upstash Redis token |
| `JURO_API_KEY` | Juro REST API key — used by sync-juro for polling |
| `SLACK_WEBHOOK_URL` | Incoming webhook for `#x-velocity-legal-pulse` |
| `JURO_WEBHOOK_SECRET` | Optional — validates Juro webhook signature |

### Local development

```bash
npm install
vercel env pull .env.local   # pulls production env vars locally
vercel dev                   # runs functions + static files locally
```

---

## Juro setup

### Webhook (real-time)
In Juro → Settings → Webhooks:
- **URL:** `https://legal-velocity.vercel.app/api/webhook`
- **Events:** Contract sent for approval, Contract fully approved

### API sync (every 10 min)
Configured in `vercel.json` as a Vercel Cron Job. Requires Vercel Pro.
Manual trigger: `POST https://legal-velocity.vercel.app/api/sync-juro?full=true`

---

## Redis key reference

| Key pattern | Type | Contents |
|---|---|---|
| `juro:contract:{id}` | JSON | Contract record from Juro API sync |
| `juro:contract_ids` | JSON array | IDs of all Juro-synced contracts |
| `juro:event_log` | Sorted set | Full turn history (score = timestamp ms) |
| `juro:event_dedup` | Set | Dedup keys to prevent duplicate log entries |
| `juro:state:{id}` | JSON | Last-seen approval state for change detection |
| `juro:last_synced` | String | ISO timestamp of last successful sync |
| `contract:{id}` | JSON | Contract record from webhook (real-time) |
| `contract_ids` | JSON array | IDs of webhook-tracked contracts |
| `feed` | List | Last 50 activity events |
| `last_updated` | String | ISO timestamp of last data write |

---

## Folder contents

```
legal-velocity/
├── index.html          ← main dashboard (seed data + live overlay)
├── breach.html         ← SLA breach analysis
├── api/
│   ├── webhook.js      ← Juro webhook receiver (real-time events)
│   ├── sync-juro.js    ← Juro API polling sync + history logging
│   ├── contracts.js    ← merged contracts API
│   ├── feed.js         ← recent activity feed
│   └── history.js      ← full turn history with SLA durations
├── seed-history.js     ← one-time script: seeds historical data into Redis
├── vercel.json         ← routes + cron config (10-min sync)
├── package.json
├── .env.example        ← required environment variables
├── DATA_MODEL.md       ← turn data structure + Juro event mapping
└── NEXT_STEPS.md       ← backlog and status
```
