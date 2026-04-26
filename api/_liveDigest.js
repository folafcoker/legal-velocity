const { turnStartMs, openTurnBusinessHours } = require('./_sla.js');

/** Monday 00:00:00.000 UTC of the current calendar week (ISO week, Mon–Sun). */
function startOfWeekMondayUTC(now = Date.now()) {
  const d = new Date(now);
  const utcDow = d.getUTCDay();
  const diff = utcDow === 0 ? 6 : utcDow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function formatOutLabel(startMs) {
  try {
    return new Date(startMs).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/**
 * Webhook `contract:*` turns: **out to legal** with open time in [Mon 00:00 UTC this week, now].
 */
function thisWeekOutToLegal(contracts, now = Date.now()) {
  const weekStart = startOfWeekMondayUTC(now);
  const items = [];
  for (const c of contracts) {
    if (!c || !Array.isArray(c.turns)) continue;
    for (const t of c.turns) {
      const start = turnStartMs(t);
      if (start == null || start < weekStart || start > now) continue;
      items.push({
        name: c.name || '—',
        contractId: c.id,
        juroUrl: c.juroUrl || null,
        outAt: start,
        outLabel: formatOutLabel(start),
        open: !t.returnedDate,
      });
    }
  }
  items.sort((a, b) => b.outAt - a.outAt);
  return {
    weekStartMs: weekStart,
    weekStartIso: new Date(weekStart).toISOString().slice(0, 10),
    items,
  };
}

/**
 * Condensed line from 7d Slack `flat` items (same as live-log slackItems).
 */
function buildSlackDigest(flat) {
  if (!flat || !flat.length) {
    return { summary: 'No Slack messages in the 7-day sync window.', lineCount: 0, fromTotal: 0 };
  }
  const recent = [...flat].sort((a, b) => b.at - a.at).slice(0, 7);
  const parts = recent.map((s) => {
    const t = (s.title || s.rawText || '').replace(/\s+/g, ' ').trim();
    return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  });
  let summary = parts.join(' · ');
  if (summary.length > 700) summary = summary.slice(0, 700) + '…';
  return { summary, lineCount: recent.length, fromTotal: flat.length };
}

/**
 * 1–2 short, actionable lines (metrics-aware + generic backfill, not AI).
 */
function buildProcessHints({ openOverSla48h, thisWeekOutCount, returned7d, openNow, sentToLegal7d }) {
  const pool = [];
  if (openOverSla48h > 0) {
    pool.push(
      `Chase the ${openOverSla48h} case(s) past 48h SLA first—agree the next action in Slack and in Juro.`,
    );
  }
  if (thisWeekOutCount > 0) {
    pool.push(
      `${thisWeekOutCount} contract(s) to legal this calendar week; keep a one-line “why we need it” in Slack and priority / internal status fields up to date.`,
    );
  }
  if (openNow > 0) {
    pool.push(
      `You have ${openNow} open with legal; confirm a single owner per Juro file so handoffs are unambiguous.`,
    );
  }
  if (returned7d > 0 && sentToLegal7d > 0) {
    pool.push('Reconcile new intakes vs. returns: if the queue grows, batch similar agreements or time-box response.');
  }
  pool.push('Daily: sweep #commercial-contracts for blockers, pin the decision, and close the loop in-thread.');
  pool.push('Use Juro smart fields consistently so the queue, Slack, and on-contract state stay aligned.');

  const out = [];
  for (const p of pool) {
    if (!out.includes(p)) out.push(p);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * All open approval turns (no return yet) across webhook `contract:*` records.
 * `internalStatus` is set on new turns from the Juro webhook; older rows may not have it.
 */
function listOpenWithLegal(contracts, now = Date.now()) {
  const byContract = new Map();
  for (const c of contracts) {
    if (!c || !Array.isArray(c.turns)) continue;
    const contractKey = c.id || c.name || '';
    if (!contractKey) continue;
    for (const t of c.turns) {
      if (t.returnedDate) continue;
      const bh = openTurnBusinessHours(t, now);
      const startedAtMs = turnStartMs(t) || 0;
      const row = {
        name: c.name || '—',
        contractId: c.id,
        juroUrl: c.juroUrl || null,
        sentToElaine: t.sentToElaine || null,
        sentAt: t.sentAt || null,
        openedAtIso: t.openedAtIso || null,
        withLegalBusinessHours: bh != null && !isNaN(bh) ? Math.round(bh * 10) / 10 : null,
        internalStatus:
          t.internalStatus != null && String(t.internalStatus).trim() !== ''
            ? String(t.internalStatus).trim()
            : '—',
        _startedAtMs: startedAtMs,
      };
      const prev = byContract.get(contractKey);
      if (!prev || startedAtMs > (prev._startedAtMs || 0)) {
        byContract.set(contractKey, row);
      }
    }
  }
  const rows = [...byContract.values()].map(({ _startedAtMs, ...rest }) => rest);
  rows.sort((a, b) => {
    const ta = a.openedAtIso ? new Date(a.openedAtIso).getTime() : 0;
    const tb = b.openedAtIso ? new Date(b.openedAtIso).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return (a.name || '').localeCompare(b.name || '');
  });
  return rows;
}

module.exports = {
  startOfWeekMondayUTC,
  thisWeekOutToLegal,
  buildSlackDigest,
  buildProcessHints,
  listOpenWithLegal,
};
