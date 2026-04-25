# Data Model

Live ingestion paths and Redis keys are documented in **`README.md`**. As of 2026, **webhook-driven** updates are primary; optional Juro REST sync is documented there and off by default.

## Core concept

Each **contract** has one or more **turns**.

A turn = one loop through Elaine:
- **Clock starts** → `contract.approval_requested` sent to `elaine@granola.so`
- **Clock stops** → whichever fires first:
  - `contract.approval_requested` sent to anyone *other than* Elaine (she approved, next person notified)
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
| `contract.approval_requested`    | `sentToElaine`   | recipient = `elaine@granola.so`            |
| `contract.approval_requested`    | `returnedDate`   | recipient ≠ `elaine@granola.so`, after sentToElaine |
| `contract.approval_process_finished` | `returnedDate` | fires after sentToElaine, no subsequent approval_requested yet |

---

## Day count rules

| Condition                        | Display         |
|----------------------------------|-----------------|
| `returnedDate` is set            | Show days, coloured green (≤3d) / amber (≤7d) / red (>7d) |
| `returnedDate` is null           | Show `—` — no running count, clock not stopped |

---

## Multi-turn contracts

A contract gets a new turn entry each time it re-enters Elaine's queue after having previously left it. The contract row shows the **avg days across completed turns**. Expanding shows each turn individually.
