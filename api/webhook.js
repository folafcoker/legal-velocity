const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ELAINE_EMAIL = 'elaine@granola.so';

// ─── Juro payload helpers ─────────────────────────────────────────────────────
//
// Actual Juro webhook shape (confirmed from live payload):
// {
//   event: { type: "contract.approval_requested", by: { email, name, side } },
//   contract: {
//     id, name,
//     template: { id, name },
//     owner: { name, username },          ← username = email
//     fields: [{ title, type, value, choices, uid }],
//     internalUrl: "https://app.juro.com/sign/{id}",
//     state: { approval: { approvers: [{ username, status }] } },
//     updatedDate
//   }
// }

/** Pull a named smartfield value from the contract.fields array (matches on title). */
function smartfield(fields = [], ...titles) {
  for (const title of titles) {
    const f = fields.find(f => (f.title || '').toLowerCase() === title.toLowerCase());
    if (f && f.value != null && f.value !== '') return String(f.value);
  }
  return null;
}

// ─── Slack notification ───────────────────────────────────────────────────────

async function sendSlackNotification({ contractName, docType, contractId, priority, internalStatus, owner, approver, juroUrl, timestamp }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:page_with_curl: Hey — *${contractName}* just went out for approval!` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Contract Name*\n${contractName}` },
          { type: 'mrkdwn', text: `*Document Type*\n${docType}` },
          { type: 'mrkdwn', text: `*Contract ID*\n\`${contractId}\`` },
          { type: 'mrkdwn', text: `*Priority Level*\n${priority}` },
          { type: 'mrkdwn', text: `*Internal Status*\n${internalStatus}` },
          { type: 'mrkdwn', text: `*Owner*\n${owner}` },
          { type: 'mrkdwn', text: `*Approver*\n${approver}` },
          { type: 'mrkdwn', text: `*Sent at*\n${formatTs(timestamp)}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type:  'button',
            text:  { type: 'plain_text', text: 'View in Juro →', emoji: false },
            url:   juroUrl,
            style: 'primary',
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) console.warn('[slack] POST failed:', res.status, await res.text());
    else         console.log('[slack] notification sent for', contractName);
  } catch (e) {
    console.warn('[slack] notification error:', e.message);
  }
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

function normalizeName(title = '') {
  let name = title.replace(/\.docx?$/i, '').trim();

  // "Company + Granola - ..." or "Company, Granola - ..."
  let m = name.match(/^(.+?)\s*[,+]\s*Granola\b/i);
  if (m) return m[1].trim();

  // "Granola - Company - ..." or "Granola_Company_..."
  m = name.match(/^Granola\s*[-_–]\s*(.+?)(?:\s*[-_–]|\s+Enterprise|\s+Order|\s+MSA|\s*$)/i);
  if (m) return m[1].trim();

  // "Granola Order Form (Acme comments ...)" — extract company from parenthetical
  m = name.match(/\((\w[\w\s]*?)\s+(?:comments|redlines?|rev\b|markup)/i);
  if (m) return m[1].trim();

  // "Granola CompanyName" — single CamelCase/Title word after Granola (not a type keyword)
  m = name.match(/^Granola\s+([A-Z][a-z]\w+)(?:\s|$)/);
  if (m) return m[1].trim();

  // "2026AIPACMNDA" → strip year prefix and known suffix → "AIPAC"
  m = name.match(/^(?:20\d{2})?([A-Z]{2,}?)(?:MNDA|MSA|DPA|NDA)$/);
  if (m) return m[1].trim();

  // Fallback: first segment before any separator
  return name.split(/\s*[-–_]\s*/)[0].trim() || name;
}

function normalizeCounterparty(templateTitle = '') {
  if (/enterprise order form/i.test(templateTitle))  return 'Enterprise Order Form';
  if (/order form/i.test(templateTitle))             return 'Order Form';
  if (/\bmnda\b/i.test(templateTitle))               return 'MNDA';
  if (/\bmsa\b/i.test(templateTitle))                return 'MSA';
  if (/poc agreement/i.test(templateTitle))           return 'POC Agreement';
  if (/\bdpa\b/i.test(templateTitle))                return 'DPA';
  if (/renewal/i.test(templateTitle))                return 'Renewal';
  return templateTitle || 'Contract';
}

function toDateStr(iso) {
  return new Date(iso).toISOString().split('T')[0];
}

function formatTs(iso) {
  const d     = new Date(iso);
  const day   = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

function firstName(nameStr = '', emailStr = '') {
  if (nameStr) return nameStr.split(/\s+/)[0];
  if (emailStr) return emailStr.split('@')[0];
  return '';
}

// ─── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.JURO_WEBHOOK_SECRET;
  if (secret) {
    const incoming = req.headers['x-juro-signature'] || req.headers['x-webhook-secret'] || '';
    if (incoming !== secret) {
      console.warn('[webhook] signature mismatch');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const body = req.body || {};
  console.log('[webhook] received:', JSON.stringify(body));

  // ── Parse Juro's actual payload shape ────────────────────────────────────
  const eventType    = (body.event?.type || '').toLowerCase();
  const juroContract = body.contract || {};
  const eventActor   = body.event?.by || {};   // person who triggered the event

  const contractId    = juroContract.id;
  const contractTitle = juroContract.name || '';
  const templateTitle = juroContract.template?.name || '';
  const timestamp     = juroContract.updatedDate || new Date().toISOString();
  const juroUrl       = juroContract.internalUrl || `https://app.juro.com/sign/${contractId}`;
  const fields        = juroContract.fields || [];

  // The approver is the person in event.by (who the event was acted on behalf of)
  const approverEmail = (eventActor.email || '').toLowerCase();
  const approverName  = eventActor.name || '';

  // Owner is on the contract itself
  const ownerName  = juroContract.owner?.name || '';
  const ownerEmail = juroContract.owner?.username || '';

  if (!contractId) {
    console.warn('[webhook] missing contractId');
    return res.status(400).json({ error: 'Missing contractId' });
  }

  const isRequested = eventType.includes('approval_requested') || eventType.includes('sent_for_approval');
  const isFinished  = eventType.includes('fully_approved')     || eventType.includes('approval_process_finished');

  if (!isRequested && !isFinished) {
    return res.status(200).json({ ok: true, message: `Ignored: ${eventType}` });
  }

  // ── Load or create contract record ────────────────────────────────────────
  const contractKey = `contract:${contractId}`;
  let contract = await kv.get(contractKey);

  if (!contract) {
    contract = {
      id:           contractId,
      name:         normalizeName(contractTitle),
      counterparty: normalizeCounterparty(templateTitle),
      turns:        [],
    };
  }

  // ── Apply event ───────────────────────────────────────────────────────────
  let feedEvent = null;

  if (isRequested) {
    const isElaine = approverEmail === ELAINE_EMAIL;
    const openIdx  = contract.turns.findIndex(t => t.returnedDate === null);

    if (isElaine) {
      contract.turns.push({
        sentToElaine: toDateStr(timestamp),
        sentAt:       formatTs(timestamp),
        sentBy:       firstName(ownerName, ownerEmail),
        returnedDate: null,
        returnedAt:   null,
        returnedTo:   null,
      });

      feedEvent = {
        type:         'turn_opened',
        contractName: contract.name,
        counterparty: contract.counterparty,
        sentBy:       firstName(ownerName, ownerEmail),
        timestamp,
      };

      // All smartfield data is already in the webhook payload — no extra API call needed
      await sendSlackNotification({
        contractName:   contract.name,
        docType:        contract.counterparty,
        contractId,
        priority:       smartfield(fields, 'Priority Level')   || '—',
        internalStatus: smartfield(fields, 'Internal Status')  || 'Sent for Approval',
        owner:          ownerName                              || ownerEmail || '—',
        approver:       approverName                           || 'Elaine Foreman',
        juroUrl,
        timestamp,
      });

    } else if (openIdx !== -1) {
      const returnedTo = firstName(approverName, approverEmail);
      contract.turns[openIdx].returnedDate = toDateStr(timestamp);
      contract.turns[openIdx].returnedAt   = formatTs(timestamp);
      contract.turns[openIdx].returnedTo   = returnedTo;
      feedEvent = {
        type:         'turn_closed',
        contractName: contract.name,
        counterparty: contract.counterparty,
        returnedTo,
        timestamp,
      };
    }

  } else if (isFinished) {
    const openIdx = contract.turns.findIndex(t => t.returnedDate === null);
    if (openIdx !== -1) {
      contract.turns[openIdx].returnedDate = toDateStr(timestamp);
      contract.turns[openIdx].returnedAt   = formatTs(timestamp);
      contract.turns[openIdx].returnedTo   = null;
    }
    feedEvent = {
      type:         'fully_approved',
      contractName: contract.name,
      counterparty: contract.counterparty,
      timestamp,
    };
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  await kv.set(contractKey, contract);
  await kv.set('last_updated', new Date().toISOString());

  const ids = (await kv.get('contract_ids')) || [];
  if (!ids.includes(contractId)) {
    await kv.set('contract_ids', [...ids, contractId]);
  }

  if (feedEvent) {
    await kv.lpush('feed', feedEvent);
    await kv.ltrim('feed', 0, 49);
  }

  return res.status(200).json({ ok: true, event: eventType, contract });
};
