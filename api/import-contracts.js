/**
 * Build contract rows from import:event_log (for breach / queue-style views).
 */
const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sortStr(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const raw = (await kv.zrange('import:event_log', 0, 1e15, { byScore: true })) || [];
  const events = raw
    .map((e) => {
      try { return typeof e === 'string' ? JSON.parse(e) : e; }
      catch { return null; }
    })
    .filter(Boolean);

  const by = new Map();
  for (const e of events) {
    const id = e.contractId || `id-${(e.contractName || 'u').replace(/\W+/g, '-').slice(0, 40)}`;
    if (!by.has(id)) {
      by.set(id, {
        id,
        name: e.contractName || 'Unknown',
        counterparty: e.counterparty || 'Contract',
        juroUrl: e.juroUrl,
        source: e.source,
        turns: [],
      });
    }
    by.get(id).turns.push({
      sentToElaine: e.sentToElaine,
      sentAt: e.sentAt,
      sentBy: e.sentBy,
      returnedDate: e.returnedDate,
      returnedAt: e.returnedAt,
      returnedTo: e.returnedTo,
    });
  }

  const contracts = [...by.values()].map((c) => {
    c.turns.sort((a, b) => sortStr(a.sentToElaine, b.sentToElaine) || (a.sentAt || '').localeCompare(b.sentAt || ''));
    return c;
  });

  contracts.sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ contracts, count: contracts.length, dataSource: 'import' });
};
