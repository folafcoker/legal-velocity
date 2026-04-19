const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  // ── Webhook contracts (live, take precedence) ──────────────────────────────
  const webhookIds       = (await kv.get('contract_ids'))       || [];
  const webhookContracts = (await Promise.all(
    webhookIds.map(id => kv.get(`contract:${id}`))
  )).filter(Boolean);

  // ── Sheet-synced contracts ─────────────────────────────────────────────────
  const sheetIds       = (await kv.get('sheet:contract_ids'))   || [];
  const sheetContracts = (await Promise.all(
    sheetIds.map(id => kv.get(`sheet:contract:${id}`))
  )).filter(Boolean);

  // ── Merge: sheet data as base, webhook data overrides by name ─────────────
  const merged = [...sheetContracts];
  for (const wc of webhookContracts) {
    const idx = merged.findIndex(c => c.name === wc.name || c.id === wc.id);
    if (idx >= 0) merged[idx] = wc;
    else          merged.push(wc);
  }

  const lastUpdated  = await kv.get('last_updated');
  const lastSynced   = await kv.get('sheet:last_synced');

  return res.status(200).json({
    contracts:   merged,
    lastUpdated: lastUpdated || null,
    lastSynced:  lastSynced  || null,
  });
};
