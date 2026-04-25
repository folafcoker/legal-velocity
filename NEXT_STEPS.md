# Legal Velocity — Status & Open Items

_Last updated: 25 Apr 2026_

---

## Live at https://legal-velocity.vercel.app

---

## Operational status

- **Juro REST / polling** — **Disabled in production** unless `JURO_SYNC_ENABLED=true`. The app previously hit Juro **rate limits** (monthly quota and/or throttling). Polling and the old frequent cron are removed; **webhooks** are the primary live path.
- **Dashboard** — Banner on `index.html` states the product is **not fully operational**, explains paused API sync / rate limits, and directs questions to **fola@granola.so**.
- **Data hygiene** — The old full-scan `api/hygiene` + `hygiene.html` report was **removed** to avoid expensive Juro REST batch calls.
- **Re-enable sync later** — After aligning with Juro on limits, set `JURO_SYNC_ENABLED=true` and run `POST /api/sync-juro` manually; do not reintroduce a high-frequency cron without a per-run cap and quota math.

---

## What's working

- **Juro sync** — `/api/sync-juro` is **off by default** (webhook-only); enable with `JURO_SYNC_ENABLED=true` for manual reconciliation only
- **Slack ingestion** — `/api/sync-slack` reads `#commercial-contracts`, extracts urgency + contract hints, stores in Redis
- **Alias matching** — `_aliases.js` maps free-text (Juro names + Slack messages) to canonical company names; both sources resolve to the same key so Slack context attaches to the right contract
- **Contract deduplication** — merges duplicate Juro/webhook records per canonical company; display name uses canonical (e.g. `Atlan_Order_Form...` → `Atlan`)
- **Filtering** — removes signed, test/demo, generic, bare Granola, supplier compliance forms, and internal Granola template docs
- **Dashboard enrichment** — urgency badges (urgent / follow-up) from Slack, expanded view shows Slack thread summaries, unmatched Slack section surfaces contracts mentioned in Slack but not yet in Juro
- **Bi-weekly remote agent** — CCR routine `trig_01PJu2wmhSd5HyKFZeohM5bL` (every other Monday 08:00 BST) also triggers Slack sync as a fallback / cross-check

---

## Unresolved

### 1. Smart fields — customer email & field mapping
**Status:** investigation started, not built.

The Juro `/contracts/:id` response includes a `fields` array. `sync-juro.js` already has a `smartfield()` helper and currently pulls `Priority Level` and `Internal Status`. The user wants to:
- Sample live contracts to confirm which smart fields are consistently populated (customer email in particular)
- Add `customerEmail` (and any other useful fields) to `buildRecord()` and surface them in the dashboard
- Use the field completeness picture to design a field mapping structure for future automation

**Files:** `api/sync-juro.js` (`buildRecord`, line ~216), `index.html` (contract row + expanded view)

---

### 2. Astronomer live contract not syncing from Juro API
**Status:** Confirmed the contract exists at `https://app.juro.com/sign/699ffa69b77e823808ba7acf?isUploaded=true` and is open. The dashboard shows it via the webhook-seeded `hist-` record, but the Juro API sync's `buildRecord` returns `null` for it.

Likely cause: when a contract is in the signing phase (`isUploaded=true`), the `state.approval.approvers` array may not contain Elaine/Julie, so `firstLegalIdx === -1` causes an early return.

**Action:** Fetch the raw Juro API detail for this contract ID (`699ffa69b77e823808ba7acf`) and inspect `state.approval.approvers` to confirm. If approvers are empty in signing phase, `buildRecord` needs a fallback — e.g. use the contract owner's turn data or treat `isUploaded` as a signal.

**Files:** `api/sync-juro.js` (`buildRecord`, lines ~178–212)

---

### 3. hist- seeded contracts have no real Juro deep links
**Status:** Historical contracts seeded before live webhooks were connected have `juroUrl: "https://app.juro.com"` (no document ID). Links in the dashboard go nowhere.

**Options:**
- Map them manually (match name → real Juro ID, update Redis)
- Accept they're archive-only and add a visual indicator (greyed link)
- Re-sync from Juro API — if the contracts are still open in Juro, the API sync will overwrite with the real URL on next run

---

### 4. Duplicate sync mechanism for Slack
**Status:** There are now two paths that both write to `slack:requests` in Redis:
- **Vercel cron** (`0 8 * * 1`) — calls `/api/sync-slack` directly, runs every Monday
- **CCR remote agent** (`trig_01PJu2wmhSd5HyKFZeohM5bL`) — intended to call the same endpoint every other Monday

These are redundant. The Vercel cron is simpler and more reliable. The CCR agent adds no extra value unless it's doing smarter filtering before pushing. **Decision needed:** keep only the Vercel cron and disable/delete the CCR routine, or give the CCR agent a distinct task (e.g. summarising and posting a digest elsewhere).

---

### 5. Return-send tracking (from original plan)
When Elaine sends a contract back to the counterparty or onward to another approver, the turn should close and record `returnedTo`. The webhook handler may already handle this via the `approval_requested` event — **needs a live test to confirm**. Fire a test approval request from Elaine in Juro and inspect the raw payload at `/api/webhook`.

**Files:** `api/webhook.js` (lines ~212–259)

---

### 6. SLA flagging (from original plan)
Surface contracts that have been with the legal team too long.

- Proposed: warn > 3 calendar days, breach > 7 days
- Show on dashboard row (colour / badge)
- Optional Slack alert when threshold crossed

**Decision needed:** calendar vs business days, warn/breach thresholds, whether to Slack alert.

**Files:** `index.html`, optionally `api/webhook.js` or new `api/sla-check.js`

---

## Backlog (lower priority)

- Dashboard grouping by status (Open / Returned / Approved) or contract type
- Filter controls: by sales rep, date range, counterparty
- Export to CSV for COO reporting
- Add `JURO_WEBHOOK_SECRET` signature verification
