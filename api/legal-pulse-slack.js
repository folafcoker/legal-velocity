/**
 * POST: send a fixed nudge to the Legal Pulse Slack (incoming webhook) listing
 * contracts currently over the webhook SLA, plus the Juro “legal under review” view link.
 * Auth: same as paste endpoints when LEGAL_PASTE_TOKEN is set.
 */
const { Redis } = require('@upstash/redis');
const { computeLiveKpis } = require('./_liveKpis.js');

const DEFAULT_JURO_REVIEW_URL =
  process.env.JURO_LEGAL_REVIEW_TABLE_URL || 'https://app.juro.com/documents/69e231247fee45cc20b50169';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

function getJsonBody(req) {
  const b = req.body;
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString('utf8'));
    } catch {
      return {};
    }
  }
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return b && typeof b === 'object' ? b : {};
}

function checkPasteAuth(req) {
  const secret = process.env.LEGAL_PASTE_TOKEN;
  if (!secret) return true;
  const h = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const x = req.headers['x-legal-paste-token'];
  if (h === secret || x === secret) return true;
  if (req.query && req.query.token === secret) return true;
  return false;
}

async function loadWebhookContracts() {
  const contractIds = (await kv.get('contract_ids')) || [];
  const cKeys = contractIds.map((id) => `contract:${id}`);
  const contractRaw = cKeys.length ? await kv.mget(...cKeys) : [];
  return contractRaw
    .map((c) => {
      const unwrapped = c?.value !== undefined && 'EX' in c ? c.value : c;
      return unwrapped && unwrapped.turns ? unwrapped : null;
    })
    .filter(Boolean);
}

function formatSentAtDetails(v) {
  if (!v) return '—';
  const ms = new Date(v).getTime();
  if (isNaN(ms)) return String(v);
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

function buildOverSlaBullets(over) {
  return over.map((x) => {
    const sentAt = formatSentAtDetails(x.sentAtDetails);
    const h = x.businessHoursOpen != null ? `${x.businessHoursOpen.toFixed(1)} h` : '—';
    return `• ${x.name || '—'}\n  ◦ Sent at: ${sentAt}\n  ◦ With legal: ${h}`;
  }).join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-legal-paste-token');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkPasteAuth(req)) {
    return res.status(401).json({ error: 'Paste token required' });
  }

  getJsonBody(req);

  const hook =
    process.env.SLACK_LEGAL_PULSE_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL;
  if (!hook) {
    return res.status(501).json({
      error: 'Set SLACK_LEGAL_PULSE_WEBHOOK_URL or SLACK_WEBHOOK_URL in the deployment environment.',
    });
  }

  const contracts = await loadWebhookContracts();
  const kpis = computeLiveKpis(contracts);
  const over = kpis.overSlaContracts || [];
  if (over.length === 0) {
    return res.status(400).json({ error: 'No contracts over the SLA right now.' });
  }

  const bullets = buildOverSlaBullets(over);
  const juroUrl = String(DEFAULT_JURO_REVIEW_URL).trim();

  const text =
    'Hey, these are the contracts that are over the SLA. Please can you take a look at the legal under review table inside Juro? Here\'s the link for that table:\n\n' +
    juroUrl +
    '\n\n' +
    '*Over SLA (from webhook):*\n' +
    bullets;

  const r = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const t = await r.text();
    return res.status(502).json({ error: 'Slack webhook failed', detail: t.slice(0, 200) });
  }
  return res.status(200).json({ ok: true, count: over.length, posted: true });
};
