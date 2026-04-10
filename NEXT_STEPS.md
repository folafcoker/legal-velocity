# Next Steps

## When the Juro export arrives

The dashboard currently runs on mock data. To wire it up to real data:

### 1. Get the export
Ask Juro for a contract activity export that includes these events:
- `contract.approval_requested`
- `contract.approval_in_progress`
- `contract.approval_process_finished`

Each event row should have: `contract_id`, `contract_name`, `counterparty`, `event_type`, `recipient_email`, `timestamp`.

### 2. Map the events → turns

For each contract, scan events in chronological order:
- When you see `contract.approval_requested` where `recipient = elaine@granola.so` → open a new turn, set `sentToElaine`
- When you see `contract.approval_requested` where `recipient ≠ elaine@granola.so` (and a turn is open) → close the turn, set `returnedDate`, `returnTrigger: "approval_requested"`
- When you see `contract.approval_process_finished` (and a turn is open) → close the turn, set `returnedDate`, `returnTrigger: "approval_process_finished"`

### 3. Replace the mock data in the HTML

Find the `const CONTRACTS = [...]` block near the top of `legal-velocity.html` and replace it with the real data. Everything else is automatic.

---

## Juro MCP improvements

The MCP server at `~/juro-mcp/server.py` has a `get_contract_activity` tool added but the Juro v3 REST API does not currently expose a timestamped audit/activity log via API key.

Options to get real-time data:
1. **Juro UI export** — manual, but works now
2. **Juro webhooks** — configure Juro to POST `contract.approval_requested` and `contract.approval_process_finished` events to an endpoint; store them; feed into the dashboard. This is the right long-term solution.
3. **Check with Juro support** — ask if the activity log API requires a different auth method (session-based vs API key)

---

## Possible dashboard improvements (backlog)

- [ ] Wire to live Juro webhook data so it auto-updates
- [ ] Add filters: by sales rep, by date range, by counterparty
- [ ] Add a second approver view (Palmer, Fola) using the same turn model
- [ ] Export to CSV for COO reporting
- [ ] Flag contracts where Elaine has had it for >7 days with no response
