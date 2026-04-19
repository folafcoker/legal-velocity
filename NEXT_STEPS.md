# Next Steps

## Status

Live and working at **https://legal-velocity.vercel.app**

Webhook integration confirmed end-to-end. Live data flowing from Juro since 17 Apr 2026.

---

## Completed ✅

- [x] Static dashboard with seed data (61 contracts, 217 turns)
- [x] Deployed to Vercel
- [x] Juro webhooks connected (`contract.approval_requested`, `contract.fully_approved`)
- [x] Upstash Redis connected for live contract state
- [x] `/api/webhook` — processes Juro events, writes turns to Redis
  - Confirmed Juro payload shape: `{ event: { type, by }, contract: { ... } }`
  - Smartfields (Priority Level, Internal Status) embedded in webhook payload
  - Contract link from `contract.internalUrl`
- [x] `/api/contracts` — serves live data to the dashboard
- [x] Live data overlay — fetches on load, merges with seed data, shows LIVE badge
- [x] `/api/feed` — last 24h approval activity feed, max 5 items, auto-refreshes every 60s
- [x] Slack notifications to `#x-velocity-legal-pulse` on every contract sent to Elaine
  - Priority Level, Internal Status, Owner, direct Juro link
- [x] Active/live contracts sorted to top of dashboard (live+open → open → closed, newest first)
- [x] Contract name normalisation for Juro API name formats
  - Parenthetical company: "Granola Order Form (Acme comments...)" → "Acme"
  - Single-word company: "Granola Teramind" → "Teramind"
  - Acronym cleanup: "2026AIPACMNDA" → "AIPAC"
- [x] End-to-end test passed — Slack, Redis, dashboard all confirmed working

---

## Up next (define in next session) 🔜

- [ ] **Track return sends from Elaine** — when Elaine sends the contract back out for
      approval (to another approver or back to sales), close the turn and record who
      she passed it to. Currently only `fully_approved` closes a turn; need to handle
      `approval_requested` events where `event.by.email = elaine@granola.so` as the
      turn-close trigger.

- [ ] **SLA flagging** — define the SLA threshold (e.g. >3d = warn, >7d = breach) and
      surface contracts that are breaching. Needs: flag on dashboard rows, Slack alert
      when a contract crosses the threshold, TBD logic for business hours vs calendar days.

- [ ] **Better grouping** — define how contracts should be grouped/displayed. Options:
      by counterparty, by contract type, by sales rep (owner), by status. TBD.

---

## Backlog

- [ ] Add filters: by sales rep, by date range, by counterparty
- [ ] Add a second approver view (Palmer, Fola) using the same turn model
- [ ] Export to CSV for COO reporting
- [ ] Consider adding `JURO_WEBHOOK_SECRET` for signature verification once stable
