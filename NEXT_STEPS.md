# Next Steps

## Status

Live and working at **https://legal-velocity.vercel.app**

Webhook integration confirmed end-to-end on 17 Apr 2026.

---

## Completed ✅

- [x] Static dashboard with seed data (61 contracts, 217 turns)
- [x] Deployed to Vercel
- [x] Juro webhooks connected (`contract.approval_requested`, `contract.fully_approved`)
- [x] Upstash Redis connected for live contract state
- [x] `/api/webhook` — processes Juro events, writes turns to Redis
  - Confirmed: Juro payload shape is `{ event: { type, by }, contract: { ... } }`
  - Smartfields (Priority Level, Internal Status) come embedded in the webhook payload — no extra API call needed
  - Juro contract link comes from `contract.internalUrl`
- [x] `/api/contracts` — serves live data to the dashboard
- [x] Live data overlay — dashboard fetches on load, merges with seed data, shows LIVE badge
- [x] `/api/feed` — last 24h approval activity feed, max 5 items, auto-refreshes every 60s
- [x] Slack notifications to `#x-velocity-legal-pulse` on every contract sent to Elaine
  - Contract Name, Document Type, Contract ID
  - Priority Level + Internal Status from Juro smartfields
  - Owner from `contract.owner`
  - Approver name
  - "View in Juro →" button with direct contract link
- [x] End-to-end test passed — Slack message confirmed received

---

## Backlog

- [ ] Add filters: by sales rep, by date range, by counterparty
- [ ] Add a second approver view (Palmer, Fola) using the same turn model
- [ ] Export to CSV for COO reporting
- [ ] Flag contracts where Elaine has had it >7 days with no response
- [ ] Consider adding `JURO_WEBHOOK_SECRET` for signature verification once stable
