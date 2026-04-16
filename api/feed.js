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

  // Read up to 50 recent events, filter to last 24h, return max 5
  const raw    = (await kv.lrange('feed', 0, 49)) || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const items = raw
    .map(e => (typeof e === 'string' ? JSON.parse(e) : e))
    .filter(e => new Date(e.timestamp).getTime() >= cutoff)
    .slice(0, 5);

  return res.status(200).json(items);
};
