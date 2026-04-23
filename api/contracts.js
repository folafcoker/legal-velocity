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

  // ── Fetch all ID lists in parallel ───────────────────────────────────────────
  const [juroIds, webhookIds, lastUpdated, juroLastSynced] = await Promise.all([
    kv.get('juro:contract_ids').then(v => v || []),
    kv.get('contract_ids').then(v => v || []),
    kv.get('last_updated'),
    kv.get('juro:last_synced'),
  ]);

  // ── Batch-fetch all contracts ─────────────────────────────────────────────────
  const juroKeys    = juroIds.map(id => `juro:contract:${id}`);
  const webhookKeys = webhookIds.map(id => `contract:${id}`);

  const [juroRaw, webhookRaw] = await Promise.all([
    juroKeys.length    ? kv.mget(...juroKeys)    : Promise.resolve([]),
    webhookKeys.length ? kv.mget(...webhookKeys) : Promise.resolve([]),
  ]);

  function unwrap(c) {
    if (!c) return null;
    if (c.value !== undefined && 'EX' in c) return c.value;
    return c;
  }

  const juroContracts    = juroRaw.map(unwrap).filter(c => c && c.name);
  const webhookContracts = webhookRaw.map(unwrap).filter(c => c && c.name);

  // ── Merge strategy ────────────────────────────────────────────────────────────
  // Juro API sync is primary (has smart fields + current state).
  // Webhook events supplement with precise real-time timestamps and multi-turn
  // history — a webhook record wins if it has more turns than the Juro snapshot.
  const merged = [...juroContracts];

  for (const wc of webhookContracts) {
    const wcTurns = wc.turns || [];
    const idx = merged.findIndex(c => c.id === wc.id || c.name === wc.name);
    if (idx >= 0) {
      if (wcTurns.length > (merged[idx].turns || []).length) merged[idx] = wc;
    } else {
      merged.push(wc);
    }
  }

  return res.status(200).json({
    contracts:    merged,
    lastUpdated:  lastUpdated   || null,
    lastSynced:   juroLastSynced || null,
  });
};
