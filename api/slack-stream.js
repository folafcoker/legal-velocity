const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const [stream, lastSynced, requests] = await Promise.all([
    kv.get('slack:stream'),
    kv.get('slack:last_synced'),
    kv.get('slack:requests'),
  ]);

  if (stream && stream.length) {
    return res.status(200).json({
      stream: stream.map(s => ({ ...s, atIso: new Date(s.at).toISOString() })),
      lastSynced: lastSynced || null,
    });
  }

  // Backfill from requests if old sync (no stream yet)
  if (requests && requests.length) {
    const flat = [];
    for (const r of requests) {
      const parentTs = parseFloat(r.ts) * 1000;
      flat.push({
        at: parentTs,
        who: r.requester,
        text: (r.summary || '').slice(0, 500),
        type: 'parent',
        parentTs: r.ts,
        atIso: new Date(parentTs).toISOString(),
      });
      for (const t of (r.thread || [])) {
        const at = parseFloat(t.ts) * 1000;
        flat.push({
          at,
          who: t.author,
          text: t.text,
          type: 'reply',
          parentTs: r.ts,
          atIso: new Date(at).toISOString(),
        });
      }
    }
    flat.sort((a, b) => b.at - a.at);
    return res.status(200).json({ stream: flat.slice(0, 100), lastSynced: lastSynced || null });
  }

  return res.status(200).json({ stream: [], lastSynced: null });
};
