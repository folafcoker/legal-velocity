const {
  turnStartMs,
  businessHoursBetween,
  isOpenTurnOverSla,
  openTurnBusinessHours,
  SLA_HOURS,
} = require('./_sla.js');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function returnedAtMs(turn) {
  if (!turn || !turn.returnedDate) return null;
  return new Date(turn.returnedDate + 'T12:00:00.000Z').getTime();
}

function sentAtDetails(turn) {
  if (!turn) return null;
  if (turn.openedAtIso) {
    const t = new Date(turn.openedAtIso).getTime();
    if (!isNaN(t)) return new Date(t).toISOString();
  }
  if (turn.sentAt) return String(turn.sentAt);
  if (turn.sentToElaine) return String(turn.sentToElaine);
  return null;
}

/**
 * Webhook-persisted contracts (`contract:*` from Juro webhooks), same source as sla-webhook-check.
 * - 7d sent: turns whose open (to-legal) time falls in the rolling 7-day window
 * - 7d returned: turns whose return date falls in that window
 * - Avg turnaround: mean business hours (out → return) for those returned in the window
 * - Open / over SLA: all turns with no return yet
 */
function computeLiveKpis(contracts, now = Date.now()) {
  const cutoff = now - SEVEN_DAYS_MS;
  const sentToLegalIds = new Set();
  const returnedIds = new Set();
  const turnaroundSamples = [];
  const openNowIds = new Set();
  const openOverSlaIds = new Set();
  const overSlaById = new Map();

  for (const c of contracts) {
    if (!c || !Array.isArray(c.turns)) continue;
    const contractKey = c.id || c.name || '';
    for (const t of c.turns) {
      const start = turnStartMs(t);
      if (start == null) continue;

      if (t.returnedDate) {
        const rEnd = returnedAtMs(t);
        if (rEnd != null && !isNaN(rEnd) && rEnd >= cutoff && rEnd <= now) {
          if (contractKey) returnedIds.add(contractKey);
          const bh = businessHoursBetween(start, rEnd);
          if (bh >= 0) turnaroundSamples.push(bh);
        }
      } else {
        if (contractKey) openNowIds.add(contractKey);
        if (isOpenTurnOverSla(t, now)) {
          if (contractKey) openOverSlaIds.add(contractKey);
          const bh = openTurnBusinessHours(t, now);
          const row = {
            name: c.name || '—',
            contractId: c.id,
            juroUrl: c.juroUrl || null,
            businessHoursOpen: bh != null ? Math.round(bh * 10) / 10 : null,
            approver: t.approverName || t.approverEmail || 'Legal',
            sentAtDetails: sentAtDetails(t),
            contractType: c.counterparty || '—',
            owner: c.owner || t.sentBy || '—',
            priorityLevel: c.priority || t.priorityLevel || '—',
          };
          const prev = overSlaById.get(contractKey);
          if (!prev || (row.businessHoursOpen || 0) > (prev.businessHoursOpen || 0)) {
            overSlaById.set(contractKey, row);
          }
        }
      }

      if (start >= cutoff && start <= now) {
        if (contractKey) sentToLegalIds.add(contractKey);
      }
    }
  }

  const avgTurnaroundBusinessHours =
    turnaroundSamples.length > 0
      ? Math.round(
          (turnaroundSamples.reduce((a, b) => a + b, 0) / turnaroundSamples.length) * 10,
        ) / 10
      : null;

  const overSlaContracts = [...overSlaById.values()];
  overSlaContracts.sort(
    (a, b) => (b.businessHoursOpen || 0) - (a.businessHoursOpen || 0) || (a.name || '').localeCompare(b.name || ''),
  );

  return {
    windowDays: 7,
    sentToLegal7d: sentToLegalIds.size,
    returned7d: returnedIds.size,
    avgTurnaroundBusinessHours,
    openNow: openNowIds.size,
    openOverSla48h: openOverSlaIds.size,
    overSlaContracts,
    slaHours: SLA_HOURS,
  };
}

module.exports = { computeLiveKpis, SEVEN_DAYS_MS };
