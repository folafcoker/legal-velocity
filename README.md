# Legal Velocity — Elaine Approval Turnaround

Live dashboard tracking how long contracts spend with the legal team (Elaine Foreman + Julie Plisinski) during the internal approval loop.

**Live:** https://legal-velocity.vercel.app

### Current operations (2026)

- **Juro REST usage is off by default** — `/api/sync-juro` returns **503** unless `JURO_SYNC_ENABLED=true` in Vercel. There is **no** Juro sync cron. This avoids burning the Juro API monthly quota (30k calls/month) and throttling (10 rps / burst 20).
- **Primary live path:** Juro **webhooks** → `/api/webhook` → Redis. No automated full contract scans.
- The **main dashboard** (`index.html`) shows a **yellow banner** explaining the product is not fully operational, why, and to contact **fola@granola.so** for questions.
- **Slack contract sync** still runs on a schedule: Vercel cron calls `/api/sync-slack` weekly (Mondays 08:00 UTC) — this does **not** call the Juro API.
- **Usage / quota math:** `GET /api/juro-usage` (Redis-only; no Juro calls) for day/month counters when sync has run in the past.
- **Dashboard default:** `GET /api/contracts?source=webhook` — main table is **webhook-only** unless you check “Show merged list”. A **Slack thread stream** reads from `GET /api/slack-stream` (refreshed when `/api/sync-slack` runs).
- **SLA (webhook):** `GET /api/sla-webhook-check` every 15 minutes (Vercel cron). Flags open legal turns (no return webhook) over **48 business hours** and posts to `SLACK_SLA_USER_ID` (bot DM) or `SLACK_SLA_WEBHOOK_URL` / `SLACK_WEBHOOK_URL`. Deduped in Redis per contract + turn start.

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
    ├── webhook POST (real-time, primary source of truth)
    │       ↓
    │   /api/webhook        ← parses event, updates Redis, fires Slack
    │
    └── Juro REST API (optional — off by default; no cron)
            ↓
        /api/sync-juro      ← manual only when JURO_SYNC_ENABLED=true

Upstash Redis
    ├── juro:contract:{id}      ← current contract + turns (from API sync)
    ├── contract:{id}           ← contract + turns (from webhook, real-time)
    ├── juro:event_log          ← sorted set: full history of every turn
    ├── juro:event_dedup        ← set: prevents duplicate history entries
    ├── juro:state:{id}         ← last-seen approval state per contract
    └── feed                    ← list: last 50 recent activity events

/api/contracts    ← webhook-primary merge, with Juro as supplemental enrichment
/api/feed         ← last 24h activity (max 5 items)
/api/history      ← full turn history with business-day durations
/api/sync-juro    ← disabled unless JURO_SYNC_ENABLED=true (webhook-only by default)

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
| `/api/sync-juro` | GET/POST | Optional REST sync — returns 503 unless `JURO_SYNC_ENABLED=true` |
| `/api/juro-usage` | GET | Juro usage + limit diagnostics (month/day counters + quota math) |
| `/api/contracts` | GET | Contract data; add `?source=webhook` for webhook-only (default in UI) |
| `/api/feed` | GET | Last 5 approval events from the last 24h |
| `/api/history` | GET | Full turn history; supports `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `/api/slack-stream` | GET | Thread stream for `#commercial-contracts` (from last Slack sync) |
| `/api/sla-webhook-check` | GET/POST | Open-turn SLA check (webhook contracts only); Vercel cron or `?secret=` |
| `/api/sync-slack` | GET | Slack ingestion (cron + manual); no Juro API |
| `/api/sync-sheet` | POST | Google Sheet import into Redis (if used) |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `KV_REST_API_URL` | Upstash Redis URL (auto-injected by Vercel integration) |
| `KV_REST_API_TOKEN` | Upstash Redis token |
| `JURO_API_KEY` | Juro REST API key — required only if you enable `/api/sync-juro` |
| `JURO_SYNC_MAX_CALLS` | Optional — max Juro API calls per sync run (default `150`) |
| `JURO_SYNC_ENABLED` | Set `true` to allow `/api/sync-juro` (default: off — webhook-only) |
| `JURO_SYNC_LOCK_TTL_SECONDS` | Optional — sync lock TTL seconds (default `900`) |
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

### Juro REST sync (optional, off by default)
There is **no** Juro sync cron. To run a one-off reconciliation after talking to Juro, set `JURO_SYNC_ENABLED=true` and call:
`POST https://legal-velocity.vercel.app/api/sync-juro?full=true`

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
| `juro:usage:day:*` | JSON | Per-day Juro API call stats (from sync runs, when enabled) |
| `juro:usage:month:*` | JSON | Per-month Juro API call stats (from sync runs, when enabled) |

---

## Folder contents

```
legal-velocity/
├── index.html          ← main dashboard (ops banner, seed + live data)
├── breach.html         ← SLA breach analysis
├── api/
│   ├── webhook.js      ← Juro webhook → Redis + Slack
│   ├── sync-juro.js    ← optional Juro REST sync (opt-in via JURO_SYNC_ENABLED)
│   ├── contracts.js    ← merged contracts API (webhook-primary)
│   ├── juro-usage.js   ← usage / quota helpers (Redis only)
│   ├── feed.js         ← recent activity feed
│   ├── history.js      ← full turn history + business-day durations
│   ├── sync-slack.js   ← #commercial-contracts → Redis
│   ├── sync-sheet.js   ← sheet import (if used)
│   └── _aliases.js     ← company name canonicalisation
├── seed-history.js     ← one-time script: seeds historical data into Redis
├── vercel.json         ← routes; crons: Slack sync only (no Juro sync)
├── package.json
├── .env.example        ← environment variable template
├── DATA_MODEL.md       ← turn data + Juro event mapping
├── NEXT_STEPS.md       ← status, backlog, open items
└── README.md           ← this file
```
