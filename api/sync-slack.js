const { Redis } = require('@upstash/redis');
const { resolveCompany } = require('./_aliases');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SLACK_TOKEN   = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID    = 'C099EHC7DC2'; // #commercial-contracts
const LOOKBACK_DAYS = 14;            // fetch last 2 weeks on each bi-weekly run

// Keywords that indicate urgency
const URGENCY_HIGH = [
  'p1', 'blocking', 'blocked', 'urgent', 'asap', 'today', 'call tomorrow',
  'call today', 'customer chasing', 'chasing', 'top priority', 'priority',
  'need back', 'need it back', 'need this back', 'eod', 'end of day',
];
const URGENCY_MED = [
  'this week', 'end of week', 'eow', 'next week', 'soon', 'when you can',
  'following up', 'checking in', 'any update', 'check in',
];

// Request type keywords
const TYPE_MAP = [
  ['prioritisation', ['prioriti', 'queue', 'order', 'first', 'ahead of']],
  ['legal call',     ['call', 'meeting', 'zoom', 'available for', 'am pt', 'pm pt', 'am pacific', 'pm pacific']],
  ['guidance',       ['advise', 'advice', 'guidance', 'view on', 'opinion', 'thoughts on', 'concern', 'issue', 'clause', 'redline', 'section']],
  ['admin',          ['upload', 'juro', 'template', 'process', 'workflow', 'submission']],
];

function detectUrgency(text) {
  const t = text.toLowerCase();
  if (URGENCY_HIGH.some(k => t.includes(k))) return 'high';
  if (URGENCY_MED.some(k => t.includes(k))) return 'medium';
  return 'normal';
}

function detectType(text) {
  const t = text.toLowerCase();
  for (const [type, keywords] of TYPE_MAP) {
    if (keywords.some(k => t.includes(k))) return type;
  }
  return 'general';
}

function extractContractHint(text) {
  const clean = text.replace(/<@[A-Z0-9]+\|?[^>]*>/g, '').replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').trim();
  return resolveCompany(clean);
}

async function fetchSlackMessages(oldest) {
  const messages = [];
  let cursor;

  do {
    const params = new URLSearchParams({
      channel: CHANNEL_ID,
      oldest:  String(oldest),
      limit:   '200',
      ...(cursor ? { cursor } : {}),
    });

    const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    });

    if (!res.ok) throw new Error(`Slack API HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);

    for (const msg of (data.messages || [])) {
      if (msg.subtype) continue; // skip joins, channel events
      messages.push(msg);
    }

    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);

  return messages;
}

async function fetchThreadReplies(ts) {
  const params = new URLSearchParams({ channel: CHANNEL_ID, ts, limit: '200' });
  const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.ok) return [];
  return (data.messages || []).slice(1); // skip parent message
}

async function resolveUserName(userId, cache) {
  if (cache[userId]) return cache[userId];
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });
  const data = await res.json();
  const name = data?.user?.real_name || data?.user?.name || userId;
  cache[userId] = name;
  return name;
}

function extractUserId(text) {
  // First <@UXXXXXX> mention is usually the person being tagged (Elaine),
  // but we want the sender — handled via profile lookup
  const m = text.match(/<@([A-Z0-9]+)/);
  return m ? m[1] : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SLACK_TOKEN) {
    return res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });
  }

  const oldest = Math.floor((Date.now() - LOOKBACK_DAYS * 86400 * 1000) / 1000);

  let messages;
  try {
    messages = await fetchSlackMessages(oldest);
  } catch (err) {
    return res.status(500).json({ error: `Slack fetch failed: ${err.message}` });
  }

  const userCache = {};
  const requests  = [];

  for (const msg of messages) {
    const text = msg.text || '';
    if (!text.trim()) continue;

    // Only include messages that address legal / contracts
    const lc = text.toLowerCase();
    const isContractRelated = (
      lc.includes('elaine') || lc.includes('julie') ||
      lc.includes('juro') || lc.includes('msa') || lc.includes('dpa') ||
      lc.includes('mnda') || lc.includes('redline') || lc.includes('contract') ||
      lc.includes('order form') || lc.includes('legal') || lc.includes('poc') ||
      lc.includes('renewal') || lc.includes('signed') || lc.includes('signing')
    );
    if (!isContractRelated) continue;

    const requester = await resolveUserName(msg.user, userCache).catch(() => msg.user || 'Unknown');
    const contractHint = extractContractHint(text);
    const urgency = detectUrgency(text);
    const type    = detectType(text);

    // Fetch full thread: resolution + per-reply stream for the dashboard
    let resolution = null;
    const thread = [];
    if (msg.reply_count > 0) {
      try {
        const replies = await fetchThreadReplies(msg.ts);
        for (const r of replies) {
          const replyAuthor = await resolveUserName(r.user, userCache).catch(() => r.user || '');
          const t = (r.text || '').replace(/<@[A-Z0-9]+\|?[^>]*>/g, '@').replace(/<#[^>]+>/g, '').trim();
          thread.push({ author: replyAuthor, text: t.slice(0, 2000), ts: r.ts });
        }
        const lastReply = replies[replies.length - 1];
        if (lastReply) {
          const replyAuthor = await resolveUserName(lastReply.user, userCache).catch(() => '');
          resolution = { author: replyAuthor, text: (lastReply.text || '').slice(0, 200) };
        }
      } catch (_) { /* non-fatal */ }
    }

    // Trim message to a readable summary
    const summary = text.replace(/<@[A-Z0-9]+\|?[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);

    requests.push({
      ts:           msg.ts,
      date:         new Date(parseFloat(msg.ts) * 1000).toISOString().slice(0, 10),
      requester,
      contractHint: contractHint || null,
      requestType:  type,
      urgency,
      summary,
      replyCount:   msg.reply_count || 0,
      resolution:   resolution || null,
      thread,
    });
  }

  // Sort newest first
  requests.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

  // Flat stream for the dashboard: parent + thread replies, newest first
  const stream = [];
  for (const r of requests) {
    const parentName = r.requester || 'Unknown';
    const parentTs = parseFloat(r.ts) * 1000;
    stream.push({
      at: parentTs,
      who: parentName,
      text: (r.summary || '').slice(0, 500),
      type: 'parent',
      parentTs: r.ts,
    });
    for (const t of (r.thread || [])) {
      const at = parseFloat(t.ts) * 1000;
      stream.push({
        at,
        who: t.author,
        text: t.text,
        type: 'reply',
        parentTs: r.ts,
      });
    }
  }
  stream.sort((a, b) => b.at - a.at);
  const streamTrim = stream.slice(0, 100);

  const syncedAt = new Date().toISOString();
  await kv.set('slack:requests',    requests);
  await kv.set('slack:stream',     streamTrim);
  await kv.set('slack:last_synced', syncedAt);

  return res.status(200).json({
    synced:    syncedAt,
    extracted: requests.length,
    source:    `#commercial-contracts (last ${LOOKBACK_DAYS} days)`,
  });
};
