const { Redis } = require('@upstash/redis');
const {
  openTurnBusinessHours,
  isOpenTurnOverSla,
  turnStartMs,
  SLA_HOURS,
} = require('./_sla');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

function alertKey(contractId, turn) {
  const start = turnStartMs(turn) || 0;
  return `sla:webhook:alerted:${contractId}:${start}`;
}

async function postSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const userId = process.env.SLACK_SLA_USER_ID; // e.g. U0xxxx — bot must be able to DM or use channel below

  if (token && userId) {
    const open = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ users: userId }),
    });
    const o = await open.json();
    if (o.ok && o.channel?.id) {
      const r = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel: o.channel.id, text, mrkdwn: true }),
      });
      if (r.ok) {
        const j = await r.json();
        return j.ok;
      }
    }
  }

  const hook = process.env.SLACK_SLA_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!hook) {
    console.warn('[sla] No SLACK_SLA_USER_ID+SLACK_BOT_TOKEN or SLACK_* webhook; skipping');
    return false;
  }
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.ok;
}

function verifyRequest(req) {
  if (req.headers['x-vercel-cron'] === '1') return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.query?.secret === secret) return true;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (auth && auth === secret) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const contractIds = (await kv.get('contract_ids')) || [];
  if (!contractIds.length) {
    return res.status(200).json({ ok: true, checked: 0, breaches: 0, notified: 0 });
  }

  const keys = contractIds.map(id => `contract:${id}`);
  const raw = keys.length ? await kv.mget(...keys) : [];

  const breaches = [];
  for (let i = 0; i < contractIds.length; i++) {
    const c = raw[i];
    const unwrapped = c?.value !== undefined && 'EX' in c ? c.value : c;
    if (!unwrapped || !unwrapped.turns) continue;

    for (const t of unwrapped.turns) {
      if (t.returnedDate) continue;
      if (!isOpenTurnOverSla(t)) continue;
      const h = openTurnBusinessHours(t);
      breaches.push({
        contractId: unwrapped.id,
        name: unwrapped.name,
        juroUrl: unwrapped.juroUrl,
        businessHoursOpen: h,
        turn: t,
      });
    }
  }

  let notified = 0;
  for (const b of breaches) {
    const k = alertKey(b.contractId, b.turn);
    const already = await kv.get(k);
    if (already) continue;

    const link = b.juroUrl || `https://app.juro.com/sign/${b.contractId}`;
    const hrs = b.businessHoursOpen != null ? b.businessHoursOpen.toFixed(1) : '?';
    const text =
      `*SLA (webhook)*: *${b.name}* has been with legal for *${hrs}* business hours (>` +
      `${SLA_HOURS}h) — no return event yet. ${link}`;

    const ok = await postSlack(text);
    if (ok) {
      await kv.set(k, new Date().toISOString(), { ex: 60 * 60 * 24 * 30 });
      notified++;
    }
  }

  return res.status(200).json({
    ok: true,
    checked: contractIds.length,
    openBreaches: breaches.length,
    notified,
  });
};
