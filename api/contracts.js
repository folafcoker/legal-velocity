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

  // ── Fetch all ID lists in parallel ────────────────────────────────────────
  const [webhookIds, sheetIds, lastUpdated, lastSynced] = await Promise.all([
    kv.get('contract_ids').then(v => v || []),
    kv.get('sheet:contract_ids').then(v => v || []),
    kv.get('last_updated'),
    kv.get('sheet:last_synced'),
  ]);

  // ── Batch-fetch all contracts in two mget calls ───────────────────────────
  const webhookKeys = webhookIds.map(id => `contract:${id}`);
  const sheetKeys   = sheetIds.map(id => `sheet:contract:${id}`);

  const [webhookRaw, sheetRaw] = await Promise.all([
    webhookKeys.length ? kv.mget(...webhookKeys) : Promise.resolve([]),
    sheetKeys.length   ? kv.mget(...sheetKeys)   : Promise.resolve([]),
  ]);

  // Unwrap any legacy {EX: null, value: {...}} format from older Redis writes
  function unwrap(c) {
    if (!c) return null;
    if (c.value !== undefined && 'EX' in c) return c.value;
    return c;
  }

  const webhookContracts = webhookRaw.map(unwrap).filter(c => c && c.name);
  const sheetContracts   = sheetRaw.map(unwrap).filter(c => c && c.name);

  // ── Merge: sheet is primary; webhook wins only when it has more turns ──────
  const merged = [...sheetContracts];
  for (const wc of webhookContracts) {
    const wcTurns  = wc.turns || [];
    const idx      = merged.findIndex(c => c.name === wc.name || c.id === wc.id);
    if (idx >= 0) {
      const existing = merged[idx].turns || [];
      if (wcTurns.length > existing.length) merged[idx] = wc;
    } else {
      merged.push(wc);
    }
  }

  return res.status(200).json({
    contracts:   merged,
    lastUpdated: lastUpdated || null,
    lastSynced:  lastSynced  || null,
  });
};
