/**
 * Read-only: imported history (paste / Activity) — separate from legacy juro:event_log.
 */
const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const { buildImportContractGroups } = require('./_importContractView.js');

const US_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

function isBusinessDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !US_HOLIDAYS_2026.has(dateStr);
}

function businessDaysBetween(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  if (isNaN(start) || isNaN(end) || end < start) return null;
  let days = 0;
  const cur = new Date(start);
  while (cur < end) {
    const ds = cur.toISOString().slice(0, 10);
    if (isBusinessDay(ds)) days++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const fromMs = req.query?.from
    ? new Date(req.query.from + 'T00:00:00Z').getTime()
    : 0;
  const toMs = req.query?.to
    ? new Date(req.query.to + 'T23:59:59Z').getTime()
    : Date.now() + 86400_000;
  const limitQ = Math.min(Math.max(1, parseInt(req.query?.limit, 10) || 500), 5000);

  const raw = (await kv.zrange('import:event_log', fromMs, toMs, { byScore: true })) || [];

  const allEvents = raw
    .map((e) => {
      try { return typeof e === 'string' ? JSON.parse(e) : e; }
      catch { return null; }
    })
    .filter(Boolean)
    .map((e) => ({
      ...e,
      businessDays: e.sentToElaine && e.returnedDate
        ? businessDaysBetween(e.sentToElaine, e.returnedDate)
        : null,
    }))
    .reverse();

  const events = allEvents.slice(0, limitQ);
  const contractGroups = buildImportContractGroups(events, businessDaysBetween);
  const closed = allEvents.filter((e) => e.returnedDate);
  const open = allEvents.filter((e) => !e.returnedDate && !e.activityEvent);
  const durations = closed.map((e) => e.businessDays).filter((n) => n !== null);
  const avgDays = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;

  return res.status(200).json({
    events,
    contractGroups,
    total: allEvents.length,
    displayed: events.length,
    limit: limitQ,
    open: open.length,
    closed: closed.length,
    avgBusinessDays: avgDays,
    fromMs,
    toMs,
    dataSource: 'import',
  });
};
