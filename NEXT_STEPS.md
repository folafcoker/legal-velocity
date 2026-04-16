# Next Steps

## Status

The dashboard is live at **https://legal-velocity.vercel.app** with full webhook integration.

---

## Completed ✅

- [x] Static dashboard with seed data (61 contracts, 217 turns)
- [x] Deployed to Vercel
- [x] Juro webhooks connected (`contract.sent_for_approval`, `contract.fully_approved`)
- [x] Upstash Redis connected for live contract state
- [x] `/api/webhook` — processes Juro events, writes turns to Redis
- [x] `/api/contracts` — serves live data to the dashboard
- [x] Live data overlay — dashboard fetches on load, merges with seed data, shows LIVE badge
- [x] `/api/feed` — last 24h approval activity feed, max 5 items, auto-refreshes every 60s
- [x] Slack notifications to `#x-velocity-legal-pulse` on every contract sent to Elaine
  - Enriched with Juro smartfields (Priority Level, Internal Status, Owner) via `JURO_API_KEY`

---

## Testing checklist for next session 🧪

### Webhook end-to-end
- [ ] Send a test contract to Elaine in Juro — confirm:
  - Webhook fires and logs correctly (check Vercel function logs)
  - Contract appears in `/api/contracts`
  - Dashboard shows LIVE badge and new contract row
  - Feed shows the new event under "Last 24 hours"
  - Slack message appears in `#x-velocity-legal-pulse` with correct fields

- [ ] Have Elaine return a contract — confirm:
  - Turn closes with `returnedDate` + `returnedTo` populated
  - Feed shows "returned to [name]" event

- [ ] Fully approve a contract — confirm:
  - Turn closes with `returnTrigger: approval_process_finished`
  - Feed shows "fully approved" event

### Slack notification
- [ ] Verify Priority Level, Owner, Internal Status populate from Juro smartfields
  (if blank, check what smartfield names Juro uses and update `smartfield()` in `api/webhook.js`)
- [ ] Verify "View in Juro →" button link is correct (Juro contract URL format)

### Data quality
- [ ] Check contract name normalisation looks right for new contracts
  (edit `normalizeName()` in `api/webhook.js` if names look messy)
- [ ] Confirm seed data contracts don't create duplicates when live versions arrive
  (matching is by `contract.id` then `contract.name`)

---

## Backlog

- [ ] Add filters: by sales rep, by date range, by counterparty
- [ ] Add a second approver view (Palmer, Fola) using the same turn model
- [ ] Export to CSV for COO reporting
- [ ] Flag contracts where Elaine has had it for >7 days with no response
- [ ] Verify Juro contract URL format (`https://app.juro.com/document/{id}`) — update if different
- [ ] Consider adding `JURO_WEBHOOK_SECRET` for signature verification once stable
