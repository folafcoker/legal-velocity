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

  const ids         = (await kv.get('contract_ids')) || [];
  const lastUpdated = await kv.get('last_updated');

  if (!ids.length) {
    return res.status(200).json({ contracts: [], lastUpdated: null });
  }

  const contracts = await Promise.all(ids.map(id => kv.get(`contract:${id}`)));

  return res.status(200).json({
    contracts:   contracts.filter(Boolean),
    lastUpdated: lastUpdated || null,
  });
};
