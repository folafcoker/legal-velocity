# Data Model

Live ingestion paths and Redis keys are documented in **`README.md`**. As of 2026, **webhook-driven** updates are primary; optional Juro REST sync is documented there and off by default.

## Core concept

Each **contract** has one or more **turns**.

A turn = one loop through legal (Elaine + Julie):
- **Clock starts** → `contract.approval_requested` sent to `elaine@granola.so` or `julie@granola.so` from outside legal
- **Clock stops** → whichever fires first:
  - `contract.approval_requested` sent to anyone outside legal (handoff from legal to another approver)
  - `contract.approval_process_finished` (all approvers done)
- **Still open** → neither event has fired yet — shown as `—`, no day count

---

## Data shape (inside the HTML file)

```js
const CONTRACTS = [
  {
    name:         "Contract name",
    counterparty: "Company name",
    turns: [
      {
        sentToElaine:  "YYYY-MM-DD",  // contract.approval_requested → elaine@granola.so
        returnedDate:  "YYYY-MM-DD",  // next approval_requested (non-Elaine) OR approval_process_finished
        returnTrigger: "approval_requested" | "approval_process_finished" | null,
      },
      // additional turns if contract went back to Elaine more than once
    ],
  },
];
```

---

## Juro event mapping

| Juro Event                       | Field            | Condition                                  |
|----------------------------------|------------------|--------------------------------------------|
| `contract.approval_requested`    | `sentToElaine`   | recipient in legal team (`elaine@granola.so` / `julie@granola.so`) |
| `contract.approval_requested`    | `returnedDate`   | recipient outside legal team, after sentToElaine |
| `contract.approval_process_finished` | `returnedDate` | fires after sentToElaine, no subsequent approval_requested yet |

---

## Day count rules

| Condition                        | Display         |
|----------------------------------|-----------------|
| `returnedDate` is set            | Show days, coloured green (≤3d) / amber (≤7d) / red (>7d) |
| `returnedDate` is null           | Show `—` — no running count, clock not stopped |

---

## Multi-turn contracts

A contract gets a new turn entry each time it re-enters legal after previously leaving legal. The contract row shows the **avg days across completed turns**. Expanding shows each turn individually.

---

## Wrap-up note (26 Apr 2026)

- Dashboard KPI cards now count unique **contracts (contract ID)** for out/back/open metrics.
- Open queue rows are deduped to one active row per contract ID.
