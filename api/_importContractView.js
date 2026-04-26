/**
 * Group import events by the same contract identity as the queue (normalized
 * name + document type), then build *turns* with correct semantics:
 *
 * A **turn (contract pair)** = two *sent for approval* lines for the same document, in time order:
 *   (1) **out** = non-Elaine / non-Julie actor on the action line → sent **to** legal;
 *   (2) **in** = Elaine or Julie on the action line → legal **returning** (sending for approval onward).
 *   Pairing: FIFO — each *in* closes the oldest unclosed *out* for that contract.
 *
 * - TSV/JSON rows with both sent + return on one line → one complete turn.
 * - Juro Activity: every line is out **or** in; at pairing time we re-derive O/I from
 *   `isLegalCloserAction(actionLine, actorEmail)` so Redis `importRole` is not the only signal.
 *   FIFO: each *in* closes the oldest *out* for that contract = one full turn.
 * - Events are sorted by each line’s Juro time (`atMs` / `sentAt`), never by `loggedAt` (import time),
 *   or FIFO would break in bulk pastes and every *out* would look like a separate unpaired turn.
 * - `importGroupKey` (stable file stem + doc type) keeps all Juro lines for the same file in one
 *   contract block; plain `normalizeName` alone can split the same file across groups.
 * - Unmatched out rows (no return in the import) stay open; old ones are `stale` for display.
 */
const {
  importGroupKeyFromEvent,
  firstName,
  normalizeName,
  normalizeCounterparty,
} = require('./_juroImportShared.js');
const { isLegalCloserAction } = require('./_juroActivityPaste.js');

/**
 * Juro line time (atMs) or parseable activity timestamps must win over loggedAt, or a bulk
 * import puts every row at the same “imported now” time and turns process newest-first — FIFO
 * never pairs (returns drop, every out looks like its own open turn).
 */
function sortTimeFine(e) {
  if (Number.isFinite(e.atMs) && e.atMs > 0) return e.atMs;

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
  if (e.sentAt && e.sentAt !== '—') {
    const d = new Date(e.sentAt + ' 2026');
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (e.sentToElaine) {
    const t = new Date(e.sentToElaine + 'T12:00:00Z').getTime();
    if (!isNaN(t)) return t;
  }
  if (e.loggedAt) {
    const t = new Date(e.loggedAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function groupKey(e) {
  return importGroupKeyFromEvent(e);
}

/** Unmatched out rows older than this: mark stale (import is not a live clock). */
const STALE_OPEN_MS = 3 * 24 * 60 * 60 * 1000;

function isJuroActivityEvent(e) {
  if (!e || !e.actionLine) return false;
  if (e.source === 'juro-activity') return true;
  return e.activityEvent === true;
}

/**
 * One Juro "sent for approval" line = either the **out** to legal (commercial) or the **in**
 * from legal (Elaine/Julie), regardless of what was written at import (Redis rows can be wrong
 * for old pastes). Pairing is strictly FIFO: each **in** closes the oldest unclosed **out**.
 * @returns {{side:'out',outDate:string,outAt:string,sentBy:string,event:object, t:number}|
 *  {side:'in',inDate:string,inAt:string,returnedTo:(string|null),event:object, t:number}|
 *  null}
 */
function juroToPairingSide(e) {
  if (!e || !e.actionLine) return null;
  const t = sortTimeFine(e);
  const legal = isLegalCloserAction(e.actionLine, e.actorEmail);
  if (legal) {
    if (e.sentToElaine && (e.sentAt && e.sentAt !== '—')) {
      // Mis-stored as to_legal: the timestamps are the legal *return* (in).
      return {
        side: 'in',
        t,
        inDate: e.sentToElaine,
        inAt: e.sentAt,
        returnedTo: e.returnedTo != null && e.returnedTo !== '' ? e.returnedTo : null,
        event: e,
      };
    }
    if (e.returnedDate) {
      return {
        side: 'in',
        t,
        inDate: e.returnedDate,
        inAt: e.returnedAt || null,
        returnedTo: e.returnedTo != null && e.returnedTo !== '' ? e.returnedTo : null,
        event: e,
      };
    }
    return null;
  }
  if (e.returnedDate && !e.sentToElaine) {
    // Mis-stored as return: commercial to legal is actually the **out**.
    return {
      side: 'out',
      t,
      outDate: e.returnedDate,
      outAt: e.returnedAt && e.returnedAt !== '—' ? e.returnedAt : '—',
      sentBy: e.sentBy || firstName('', e.actorEmail) || (e.actorEmail && String(e.actorEmail).split('@')[0]) || '—',
      event: e,
    };
  }
  if (e.sentToElaine) {
    return {
      side: 'out',
      t,
      outDate: e.sentToElaine,
      outAt: e.sentAt && e.sentAt !== '—' ? e.sentAt : '—',
      sentBy: e.sentBy || firstName('', e.actorEmail) || (e.actorEmail && String(e.actorEmail).split('@')[0]) || '—',
      event: e,
    };
  }
  return null;
}

/**
 * TSV/JSON/legacy, or a Juro row that could not be split into out|in (falls through).
 * @returns {{t:number,kind:'complete',e:object} | {t:number,kind:'out',out:object} | {t:number,kind:'in',inn:object} | null}
 */
function toStreamEvent(e) {
  if (isJuroActivityEvent(e)) {
    const s = juroToPairingSide(e);
    if (s) {
      if (s.side === 'out') {
        return {
          t: s.t,
          kind: 'out',
          out: {
            outDate: s.outDate,
            outAt: s.outAt,
            sentBy: s.sentBy,
            event: s.event,
          },
        };
      }
      return {
        t: s.t,
        kind: 'in',
        inn: {
          inDate: s.inDate,
          inAt: s.inAt,
          returnedTo: s.returnedTo,
          event: s.event,
        },
      };
    }
  }
  const isReturn = e.importRole === 'return_from_legal';
  const hasOut = Boolean(e.sentToElaine);
  const hasInOnRow = Boolean(e.returnedDate);
  const completeOnOneRow = hasOut && hasInOnRow && !isReturn;
  if (completeOnOneRow) {
    return { t: sortTimeFine(e), kind: 'complete', e };
  }
  if (isReturn) {
    return {
      t: sortTimeFine(e),
      kind: 'in',
      inn: {
        inDate: e.returnedDate,
        inAt: e.returnedAt,
        returnedTo: e.returnedTo,
        event: e,
      },
    };
  }
  if (hasOut && !hasInOnRow) {
    return {
      t: sortTimeFine(e),
      kind: 'out',
      out: {
        outDate: e.sentToElaine,
        outAt: e.sentAt,
        sentBy: e.sentBy,
        event: e,
      },
    };
  }
  return null;
}

function mergePairedOutIn(o, inn, businessDaysCalc) {
  const bd =
    businessDaysCalc && o.outDate && inn.inDate
      ? businessDaysCalc(o.outDate, inn.inDate)
      : null;
  const outE = o && o.event;
  const inE = inn && inn.event;
  const outAtMs = outE ? sortTimeFine(outE) : null;
  const inAtMs = inE ? sortTimeFine(inE) : null;
  return {
    source: [o.event.source, inn.event.source].filter(Boolean).join(' + ') || '—',
    outDate: o.outDate || null,
    inDate: inn.inDate || null,
    outAt: o.outAt || '—',
    inAt: inn.inAt || null,
    outAtMs: Number.isFinite(outAtMs) && outAtMs > 0 ? outAtMs : null,
    inAtMs: Number.isFinite(inAtMs) && inAtMs > 0 ? inAtMs : null,
    sentBy: o.sentBy || '—',
    returnedTo: inn.returnedTo != null && inn.returnedTo !== '' ? inn.returnedTo : null,
    businessDays: bd,
    kind: 'complete',
    contractId: o.event.contractId,
    stale: false,
  };
}

/**
 * @param {Array<object>} items - events for one contract, in any order
 * @param {(a: string, b: string) => number | null} [businessDaysCalc]
 */
function buildTurnsForGroup(items, businessDaysCalc) {
  if (!items || !items.length) return [];
  const stream = items
    .map((e, i) => ({ s: toStreamEvent(e), i, e }))
    .filter((x) => x.s != null)
    .map((x) => ({ ...x.s, i: x.i }));

  const sorted = stream.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    const ra = a.kind === 'in' ? 1 : 0;
    const rb = b.kind === 'in' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return a.i - b.i;
  });

  const pending = [];
  const turns = [];

  for (const step of sorted) {
    if (step.kind === 'complete') {
      const e = step.e;
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
    if (step.kind === 'out') {
      pending.push(step.out);
      continue;
    }
    if (step.kind === 'in') {
      const o = pending.shift();
      if (!o) continue;
      turns.push(mergePairedOutIn(o, step.inn, businessDaysCalc));
    }
  }

  for (const o of pending) {
    const t0 = sortTimeFine(o.event);
    const stale = t0 < Date.now() - STALE_OPEN_MS;
    turns.push({
      source: o.event.source || '—',
      outDate: o.outDate || null,
      inDate: null,
      outAt: o.outAt || '—',
      inAt: null,
      outAtMs: Number.isFinite(t0) && t0 > 0 ? t0 : null,
      sentBy: o.sentBy || '—',
      returnedTo: null,
      businessDays: null,
      kind: (o.event.activityEvent || o.event.source === 'juro-activity') ? 'activity' : 'open',
      contractId: o.event.contractId,
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
