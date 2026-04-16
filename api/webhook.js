const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ELAINE_EMAIL = 'elaine@granola.so';

// ─── Juro contract enrichment ─────────────────────────────────────────────────

/**
 * Optionally fetch extra fields from the Juro API (Priority, Status, Owner).
 * Requires JURO_API_KEY env var. Fails gracefully if not set or call errors.
 */
async function fetchJuroDetails(contractId) {
  const apiKey = process.env.JURO_API_KEY;
  if (!apiKey || !contractId) return null;
  try {
    const res = await fetch(`https://api.juro.com/v3/contracts/${contractId}`, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[webhook] Juro enrichment failed:', e.message);
    return null;
  }
}

/** Pull a named smartfield value from a Juro contract object (case-insensitive). */
function smartfield(juroContract, ...names) {
  const fields = juroContract?.fields || [];
  for (const name of names) {
    const f = fields.find(f => (f.name || '').toLowerCase() === name.toLowerCase());
    if (f && f.value != null && f.value !== '') return String(f.value);
  }
  return null;
}

// ─── Slack notification ───────────────────────────────────────────────────────

async function sendSlackNotification({ contract, contractId, senderName, approverName, templateTitle, timestamp, juroDetails }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const juroLink = `https://app.juro.com/document/${contractId}`;

  // Enrich fields from Juro smartfields if available
  const priority       = smartfield(juroDetails, 'priority', 'priority level', 'deal priority') || '—';
  const internalStatus = smartfield(juroDetails, 'internal status', 'status', 'contract status')
                         || juroDetails?.status || 'Sent for Approval';
  const owner          = smartfield(juroDetails, 'owner', 'account owner', 'ae', 'sales owner')
                         || senderName || '—';

  const contractName = contract.name || contractId;
  const docType      = contract.counterparty || templateTitle || '—';
  const approver     = approverName || 'Elaine Foreman';
  const sentAt       = formatTs(timestamp);

  const payload = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:page_with_curl: Hey — *${contractName}* just went out for approval!`,
        },
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
          { type: 'mrkdwn', text: `*Sent at*\n${sentAt}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text:  { type: 'plain_text', text: 'View in Juro →', emoji: false },
            url:   juroLink,
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
  } catch (e) {
    console.warn('[slack] notification error:', e.message);
  }
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

/**
 * Extract a friendly counterparty name from the raw document title.
 * Juro document titles tend to look like one of:
 *   "Komodo Health + Granola - MSA"
 *   "G2, Granola - Enterprise Order Form 2026.docx"
 *   "Granola_BCV_POC 3.24.docx"
 *   "Granola - Enterprise Order Form (PCIG Comments).docx"
 */
function normalizeName(title = '') {
  let name = title.replace(/\.docx?$/i, '').trim();

  // "Company + Granola - ..." or "Company, Granola - ..."
  let m = name.match(/^(.+?)\s*[,+]\s*Granola\b/i);
  if (m) return m[1].trim();

  // "Granola - Company - ..."  or  "Granola_Company_..."
  m = name.match(/^Granola\s*[-_–]\s*(.+?)(?:\s*[-_–]|\s+Enterprise|\s+Order|\s+MSA|\s*$)/i);
  if (m) return m[1].trim();

  // fallback: first segment before any separator
  return name.split(/\s*[-–_]\s*/)[0].trim() || name;
}

/**
 * Map a Juro template title to a short contract-type label.
 */
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

/** "2026-04-09T18:43:00.000Z" → "2026-04-09" */
function toDateStr(iso) {
  return new Date(iso).toISOString().split('T')[0];
}

/** "2026-04-09T18:43:00.000Z" → "9 Apr 18:43" (UTC) */
function formatTs(iso) {
  const d  = new Date(iso);
  const day   = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

/** First name only, falling back to the part before @ in an email. */
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

  // Optional shared-secret check — set JURO_WEBHOOK_SECRET in Vercel env vars
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

  // ── Normalise event shape ─────────────────────────────────────────────────
  // Juro may use eventType, event_type, or event at the top level
  const eventType = (body.eventType || body.event_type || body.event || '').toLowerCase();
  const data      = body.data || body.payload || body;

  // Contract identifiers
  const contractId    = data.documentId    || data.document_id    || data.contractId    || data.id;
  const contractTitle = data.documentTitle || data.document_title || data.title         || data.name  || '';
  const templateTitle = data.templateTitle || data.template_title || data.templateName  || data.type  || '';
  const timestamp     = data.createdAt     || data.created_at     || body.createdAt     || body.timestamp || new Date().toISOString();

  // Approver
  const approverObj   = data.approver || data.recipient || {};
  const approverEmail = (approverObj.email || data.approverEmail || '').toLowerCase();
  const approverName  = approverObj.name || `${approverObj.firstName || ''} ${approverObj.lastName || ''}`.trim();

  // Sender / requestedBy
  const senderObj  = data.requestedBy || data.requested_by || data.sender || data.submittedBy || {};
  const senderName = senderObj.name   || `${senderObj.firstName || ''} ${senderObj.lastName || ''}`.trim();

  if (!contractId) {
    console.warn('[webhook] missing contractId in', JSON.stringify(body));
    return res.status(400).json({ error: 'Missing contractId', received: body });
  }

  // Match Juro's actual event type strings (UI labels map to these):
  //   "Contract sent for approval"  → contract.sent_for_approval  (or approval_requested)
  //   "Approval in progress"        → contract.approval_in_progress  (ignored)
  //   "Contract fully approved"     → contract.fully_approved  (or approval_process_finished)
  const isRequested = eventType.includes('sent_for_approval')   || eventType.includes('approval_requested');
  const isFinished  = eventType.includes('fully_approved')      || eventType.includes('approval_process_finished');

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
      // New turn: contract has arrived with Elaine
      contract.turns.push({
        sentToElaine: toDateStr(timestamp),
        sentAt:       formatTs(timestamp),
        sentBy:       firstName(senderName),
        returnedDate: null,
        returnedAt:   null,
        returnedTo:   null,
      });
      feedEvent = {
        type:         'turn_opened',
        contractName: contract.name,
        counterparty: contract.counterparty,
        sentBy:       firstName(senderName),
        timestamp,
      };

      // Enrich from Juro API and fire Slack notification
      const juroDetails = await fetchJuroDetails(contractId);
      await sendSlackNotification({
        contract,
        contractId,
        senderName,
        approverName,
        templateTitle,
        timestamp,
        juroDetails,
      });
    } else if (openIdx !== -1) {
      // Close open turn: Elaine passed it to someone else
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
    // If no open turn and not Elaine → parallel-approver event, ignore.

  } else if (isFinished) {
    // Close any open turn
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

  // Push to feed (keep last 50 events)
  if (feedEvent) {
    await kv.lpush('feed', feedEvent);
    await kv.ltrim('feed', 0, 49);
  }

  return res.status(200).json({ ok: true, event: eventType, contract });
};
