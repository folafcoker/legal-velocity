const { Redis } = require('@upstash/redis');
const { groupLiveEvents } = require('./_liveGroup.js');
const { pairFeedTurns, pairToLiveRow } = require('./_pairFeedTurns.js');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function feedEventInWindow(e, cutoff) {
  const at = new Date(e.timestamp).getTime();
  return !isNaN(at) && at >= cutoff;
}

/** Keep a turn pair if any part of the approval cycle falls in the rolling window. */
function pairTouchesWindow(p, cutoff) {
  if (p.status === 'paired') {
    const oa = p.out && p.out.at;
    const ra = p.returnEvent && p.returnEvent.at;
    return (oa && oa >= cutoff) || (ra && ra >= cutoff);
  }
  if (p.status === 'open') return p.out && p.out.at >= cutoff;
  if (p.status === 'orphan_in') return p.returnEvent && p.returnEvent.at >= cutoff;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const cutoff = Date.now() - SEVEN_DAYS_MS;

  const rawFeed = (await kv.lrange('feed', 0, 499)) || [];
  const parsed = [];
  for (const row of rawFeed) {
    let e;
    try {
      e = typeof row === 'string' ? JSON.parse(row) : row;
    } catch {
      continue;
    }
    if (!e || !e.type || !e.timestamp) continue;
    parsed.push(e);
  }

  const pairs = pairFeedTurns(parsed);
  const pairsInWindow = pairs.filter((p) => pairTouchesWindow(p, cutoff));
  const webhookItems = pairsInWindow.map(pairToLiveRow);

  let slackItems = [];
  const [stream, requests, lastSynced] = await Promise.all([
    kv.get('slack:stream'),
    kv.get('slack:requests'),
    kv.get('slack:last_synced'),
  ]);

  const flat = [];
  if (stream && stream.length) {
    for (const s of stream) {
      const at = typeof s.at === 'number' ? s.at : parseFloat(s.at) * 1000;
      if (at < cutoff) continue;
      const text = (s.text || '').replace(/\s+/g, ' ').trim();
      const who = s.who || '';
      const title = who + (text ? ` — ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}` : '');
      flat.push({
        source: 'slack',
        at,
        atIso: new Date(at).toISOString(),
        kind: s.type || 'message',
        title,
        rawText: [who, text].filter(Boolean).join(' '),
        meta: s.type === 'reply' ? 'Thread reply' : '#commercial-contracts',
      });
    }
  } else if (requests && requests.length) {
    for (const r of requests) {
      const parentTs = parseFloat(r.ts) * 1000;
      const sum = (r.summary || '').slice(0, 500);
      if (parentTs >= cutoff) {
        const rawText = [r.requester, sum].filter(Boolean).join(' ');
        flat.push({
          source: 'slack',
          at: parentTs,
          atIso: new Date(parentTs).toISOString(),
          kind: 'parent',
          title: `${r.requester || ''} — ${(r.summary || '').slice(0, 200)}`,
          rawText,
          meta: 'Request',
        });
      }
      for (const t of (r.thread || [])) {
        const at = parseFloat(t.ts) * 1000;
        if (at < cutoff) continue;
        const tx = t.text || '';
        flat.push({
          source: 'slack',
          at,
          atIso: new Date(at).toISOString(),
          kind: 'reply',
          title: `${t.author || ''} — ${(tx).slice(0, 200)}${tx.length > 200 ? '…' : ''}`,
          rawText: [t.author, tx].filter(Boolean).join(' '),
          meta: 'Reply',
        });
      }
    }
  }

  slackItems = flat;

  const groups = groupLiveEvents(webhookItems, slackItems);
  const merged = [...webhookItems, ...slackItems].sort((a, b) => b.at - a.at);

  return res.status(200).json({
    groups,
    items: merged,
    windowDays: 7,
    cutoffIso: new Date(cutoff).toISOString(),
    counts: {
      webhook: webhookItems.length,
      slack: slackItems.length,
      rawFeedEvents: parsed.filter((e) => feedEventInWindow(e, cutoff)).length,
    },
    slackLastSynced: lastSynced || null,
  });
};
