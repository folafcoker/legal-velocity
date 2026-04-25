/**
 * Group import events by the same contract identity as the queue (normalized
 * name + document type), then build *turns* with correct semantics:
 *
 * A turn = contract sent **to** legal (out) → legal sends it **back** (in).
 *
 * - TSV/JSON rows with both sent + return on one line → one complete turn.
 * - Juro Activity: only "sent for approval" exists. Non-legal actor → `to_legal` (opens);
 *   Elaine/Julie actor → `return_from_legal` (legal sends onward — closes turn, FIFO per contract).
 * - Unmatched out rows (no return in the import) stay open; old ones are `stale`
 *   so the UI does not count hours to "now" forever.
 */
const { normalizeName, normalizeCounterparty, toDateStr, formatTs } = require('./_juroImportShared.js');

/** @param {object} e */
function sortTimeFine(e) {
  if (e.importRole === 'return_from_legal') {
    if (e.returnedAt && e.returnedAt !== '—') {
      const d = new Date(e.returnedAt + ' 2026');
      if (!isNaN(d.getTime())) return d.getTime();
    }
    if (e.returnedDate) {
      const t = new Date(e.returnedDate + 'T12:00:00Z').getTime();
      if (!isNaN(t)) return t;
    }
  }
  if (e.loggedAt) {
    const t = new Date(e.loggedAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (e.sentAt && e.sentAt !== '—') {
    const d = new Date(e.sentAt + ' 2026');
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (e.sentToElaine) {
    const t = new Date(e.sentToElaine + 'T12:00:00Z').getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function groupKey(e) {
  const name = normalizeName(e.contractName || '') || (e.contractName || 'Unknown').trim();
  const party = normalizeCounterparty(e.counterparty || e.contractName || '');
  return `${name.toLowerCase()}||${String(party).toLowerCase()}`;
}

/** Unmatched out rows older than this: do not show "with legal" hours to now in the UI. */
const STALE_OPEN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {Array<object>} items - events for one contract, in any order
 * @param {(a: string, b: string) => number | null} [businessDaysCalc]
 */
function buildTurnsForGroup(items, businessDaysCalc) {
  if (!items || !items.length) return [];
  const sorted = items.map((e, i) => ({ e, i })).sort((a, b) => {
    const ta = sortTimeFine(a.e);
    const tb = sortTimeFine(b.e);
    if (ta !== tb) return ta - tb;
    // Same instant: process commercial "to legal" before legal "from legal" so FIFO pairs correctly.
    const ra = a.e.importRole === 'return_from_legal' ? 1 : 0;
    const rb = b.e.importRole === 'return_from_legal' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return a.i - b.i;
  }).map((x) => x.e);

  const pending = [];
  const turns = [];

  for (const e of sorted) {
    const isReturn = e.importRole === 'return_from_legal';
    const hasOut = Boolean(e.sentToElaine);
    const hasInOnRow = Boolean(e.returnedDate);
    const completeOnOneRow = hasOut && hasInOnRow && !isReturn;

    if (completeOnOneRow) {
      turns.push({
        source: e.source || '—',
        outDate: e.sentToElaine || null,
        inDate: e.returnedDate || null,
        outAt: e.sentAt || '—',
        inAt: e.returnedAt || null,
        sentBy: e.sentBy || '—',
        returnedTo: e.returnedTo != null && e.returnedTo !== '' ? e.returnedTo : null,
        businessDays:
          e.businessDays != null
            ? e.businessDays
            : businessDaysCalc && e.sentToElaine && e.returnedDate
              ? businessDaysCalc(e.sentToElaine, e.returnedDate)
              : null,
        kind: 'complete',
        contractId: e.contractId,
        stale: false,
      });
      continue;
    }

    if (isReturn) {
      const outEv = pending.shift();
      if (!outEv) continue;
      const inDate = e.returnedDate;
      const bd =
        businessDaysCalc && outEv.sentToElaine && inDate
          ? businessDaysCalc(outEv.sentToElaine, inDate)
          : null;
      turns.push({
        source: [outEv.source, e.source].filter(Boolean).join(' + ') || '—',
        outDate: outEv.sentToElaine || null,
        inDate: inDate || null,
        outAt: outEv.sentAt || '—',
        inAt: e.returnedAt || null,
        sentBy: outEv.sentBy || '—',
        returnedTo: e.returnedTo != null && e.returnedTo !== '' ? e.returnedTo : null,
        businessDays: bd,
        kind: 'complete',
        contractId: outEv.contractId,
        stale: false,
      });
      continue;
    }

    if (hasOut && !hasInOnRow) {
      pending.push(e);
      continue;
    }
  }

  for (const outEv of pending) {
    const t0 = sortTimeFine(outEv);
    const stale = t0 < Date.now() - STALE_OPEN_MS;
    turns.push({
      source: outEv.source || '—',
      outDate: outEv.sentToElaine || null,
      inDate: null,
      outAt: outEv.sentAt || '—',
      inAt: null,
      sentBy: outEv.sentBy || '—',
      returnedTo: null,
      businessDays: null,
      kind: (outEv.activityEvent || outEv.source === 'juro-activity') ? 'activity' : 'open',
      contractId: outEv.contractId,
      stale,
    });
  }

  turns.sort((a, b) => {
    const da = a.outDate || '';
    const db = b.outDate || '';
    return db.localeCompare(da);
  });
  return turns;
}

/**
 * @param {Array<object>} events - import:event_log members (optionally w/ businessDays)
 * @param {(a: string, b: string) => number | null} [businessDaysBetween] - from import-history
 * @returns {Array<object>}
 */
function buildImportContractGroups(events, businessDaysBetween) {
  const calc = businessDaysBetween
    ? (a, b) => businessDaysBetween(a, b)
    : null;

  const by = new Map();
  for (const e of events) {
    if (!e) continue;
    const k = groupKey(e);
    if (!by.has(k)) {
      by.set(k, {
        key: k,
        name: normalizeName(e.contractName || '') || (e.contractName || 'Unknown'),
        counterparty: normalizeCounterparty(e.counterparty || e.contractName || ''),
        __items: [],
      });
    }
    by.get(k).__items.push(e);
  }

  const out = [];
  for (const g of by.values()) {
    const turns = buildTurnsForGroup(g.__items, calc);
    const lastAt = Math.max(0, ...g.__items.map((e) => sortTimeFine(e)));
    delete g.__items;
    g.turns = turns;
    g.lastAt = lastAt;
    out.push(g);
  }
  out.sort((a, b) => b.lastAt - a.lastAt);
  return out;
}

module.exports = {
  buildImportContractGroups,
  buildTurnsForGroup,
  groupKey,
  sortTimeFine,
};
