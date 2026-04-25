// Business hours (US holidays, UTC day boundaries) — mirrors index.html

const US_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
]);

function isBusinessDay(utcDayStartMs) {
  const d = new Date(utcDayStartMs);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !US_HOLIDAYS.has(d.toISOString().slice(0, 10));
}

function businessHoursBetween(startMs, endMs) {
  if (endMs <= startMs) return 0;
  const MS_PER_DAY = 86400000;
  let bh = 0;
  let dayStart = Math.floor(startMs / MS_PER_DAY) * MS_PER_DAY;
  while (dayStart < endMs) {
    if (isBusinessDay(dayStart)) {
      const lo = Math.max(startMs, dayStart);
      const hi = Math.min(endMs, dayStart + MS_PER_DAY);
      if (hi > lo) bh += (hi - lo) / 3600000;
    }
    dayStart += MS_PER_DAY;
  }
  return bh;
}

const SLA_HOURS = 48;

function turnStartMs(turn) {
  if (turn.openedAtIso) {
    const t = new Date(turn.openedAtIso).getTime();
    if (!isNaN(t)) return t;
  }
  if (turn.sentAt) {
    const t = new Date(`${turn.sentAt} 2026`).getTime();
    if (!isNaN(t)) return t;
  }
  if (turn.sentToElaine) {
    return new Date(`${turn.sentToElaine}T12:00:00.000Z`).getTime();
  }
  return null;
}

function openTurnBusinessHours(turn, endMs = Date.now()) {
  if (turn.returnedDate) return null;
  const start = turnStartMs(turn);
  if (start == null) return null;
  return businessHoursBetween(start, endMs);
}

function isOpenTurnOverSla(turn, endMs = Date.now()) {
  const h = openTurnBusinessHours(turn, endMs);
  if (h === null) return false;
  return h > SLA_HOURS;
}

module.exports = {
  businessHoursBetween,
  openTurnBusinessHours,
  isOpenTurnOverSla,
  turnStartMs,
  SLA_HOURS,
};
