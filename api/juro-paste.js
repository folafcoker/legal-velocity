const { Redis } = require('@upstash/redis');
const {
  firstName,
  normalizeName,
  normalizeCounterparty,
  stableImportGroupKey,
  slugify,
  toDateStr,
  formatTs,
  toIsoFromCell,
} = require('./_juroImportShared.js');
const { parseJuroActivityText, looksLikeJuroActivity } = require('./_juroActivityPaste.js');

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
      return { text: b };
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

/**
 * @returns {Array<{id: string, name: string, counterparty: string, turn: object}>}
 * turn: { sentIso, sentBy, returnedDateStr|null, returnedTo }
 */
function parseJsonContracts(arr) {
  if (!Array.isArray(arr)) throw new Error('JSON must be an array of contracts');
  const out = [];
  for (const src of arr) {
    if (!src.turns || !Array.isArray(src.turns) || !src.contractName) continue;
    const name = normalizeName(src.contractName);
    const counterparty = normalizeCounterparty(src.template || src.contractName);
    const id = `paste-${slugify(src.contractName)}`;
    for (const t of src.turns) {
      const sentRaw = t.sentDate || t.sentToLegal || t.start;
      if (!sentRaw) continue;
      const sentIso = toIsoFromCell(sentRaw) || (typeof sentRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sentRaw) ? new Date(sentRaw).toISOString() : null);
      if (!sentIso) continue;
      const retRaw = t.returnedDate || t.returned || t.end;
      const retIso = retRaw ? toIsoFromCell(retRaw) || (typeof retRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(retRaw) ? new Date(retRaw).toISOString() : null) : null;
      out.push({
        id,
        name,
        counterparty,
        turn: {
          sentIso,
          sentBy: t.sentBy
            ? firstName(String(t.sentBy), t.sentByEmail)
            : firstName(t.sentByName, t.sentByEmail),
          returnedDateStr: retIso ? toDateStr(retIso) : null,
          returnedTo: t.returnedTo ? firstName(String(t.returnedTo), t.returnedToEmail) : null,
        },
      });
    }
  }
  return out;
}

function parseTsvTabular(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('Need a header row and at least one data row');
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const head = lines[0].split(delim).map(h => h.trim().toLowerCase());

  const col = (aliases) => {
    for (const a of aliases) {
      const i = head.findIndex(h => h === a || h.replace(/\s/g, '') === a);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iContract = col(['contract', 'contractname', 'name', 'title', 'document']);
  const iTemplate = col(['template', 'type', 'doctype', 'documenttype']);
  const iSent = col(['sent', 'sentdate', 'start', 'senttlegal', 'opened']);
  const iRet = col(['returned', 'returneddate', 'end', 'closed']);
  const iSentBy = col(['sentby', 'from', 'requester']);
  const iRetTo = col(['returnedto', 'to', 'approver']);

  if (iContract < 0 || iSent < 0) {
    throw new Error('TSV/CSV must include contract name and sent date columns (see /history page)');
  }

  const out = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = lines[n].split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    const contractName = cells[iContract] || '';
    if (!contractName) continue;
    const sentCell = cells[iSent];
    const retCell = iRet >= 0 ? cells[iRet] : '';
    const sentIso = toIsoFromCell(sentCell) || (sentCell && /^\d{4}-\d{2}-\d{2}/.test(sentCell) ? new Date(sentCell).toISOString() : null);
    if (!sentIso) continue;
    const name = normalizeName(contractName);
    const tpl = (iTemplate >= 0 && cells[iTemplate]) || contractName;
    const counterparty = normalizeCounterparty(tpl);
    const id = `paste-${slugify(contractName)}`;
    const retIso = retCell ? toIsoFromCell(retCell) : null;
    out.push({
      id,
      name,
      counterparty,
      turn: {
        sentIso,
        sentBy: iSentBy >= 0 && cells[iSentBy] ? firstName(cells[iSentBy], '') : '',
        returnedDateStr: retIso ? toDateStr(retIso) : null,
        returnedTo: iRetTo >= 0 && cells[iRetTo] ? firstName(cells[iRetTo], '') : null,
      },
    });
  }
  return out;
}

async function writeRows(rows, dryRun) {
  let eventsLogged = 0;
  let skipped = 0;

  for (const { id, name, counterparty, turn } of rows) {
    const { sentIso, sentBy, returnedDateStr, returnedTo } = turn;
    const sentToElaine = toDateStr(sentIso);
    if (!sentToElaine) { skipped++; continue; }
    const dedupKey = `paste:${id}:${sentToElaine}`;

    if (dryRun) {
      eventsLogged++;
      continue;
    }

    const already = await kv.sismember('import:event_dedup', dedupKey);
    if (already) {
      skipped++;
      continue;
    }

    const eventTs = new Date(sentToElaine + 'T12:00:00Z').getTime() || Date.now();
    const entry = {
      contractId: id,
      contractName: name,
      counterparty,
      sentBy: sentBy || '—',
      sentToElaine,
      sentAt: formatTs(sentIso),
      returnedDate: returnedDateStr,
      returnedAt: returnedDateStr ? formatTs(returnedDateStr + 'T12:00:00Z') : null,
      returnedTo: returnedTo || null,
      isOpen: !returnedDateStr,
      source: 'paste',
      loggedAt: new Date().toISOString(),
      juroUrl: 'https://app.juro.com',
    };

    await kv.zadd('import:event_log', { score: eventTs, member: JSON.stringify(entry) });
    await kv.sadd('import:event_dedup', dedupKey);
    const ids = (await kv.get('import:contract_ids')) || [];
    if (!ids.includes(id)) await kv.set('import:contract_ids', [...ids, id]);
    eventsLogged++;
  }

  await kv.set('last_updated', new Date().toISOString());
  return { eventsLogged, skipped };
}

/**
 * Juro Activity table paste → import:event_log
 * - to_legal: "sent for approval" by someone not on legal (contract goes to Elaine — opens turn).
 * - return_from_legal: same Juro line shape, but actor is Elaine/Julie (legal sends for approval onward — closes turn).
 */
async function writeActivityEvents(parsed, dryRun) {
  let eventsLogged = 0;
  let skipped = 0;
  for (const row of parsed) {
    const {
      actionLine, atMs, actorEmail, templateLabel, documentTitle, role, recipientHint,
    } = row;
    const name = normalizeName(documentTitle || 'Unknown');
    const counterparty = normalizeCounterparty(
      [templateLabel, documentTitle].filter(Boolean).join(' '),
    );
    const importGroupKey = stableImportGroupKey(String(documentTitle || ''), String(templateLabel || ''));
    const id = `juro-act-${slugify((documentTitle || name).slice(0, 80))}`.replace(/-+$/, '');
    const iso = new Date(atMs).toISOString();

    if (role === 'return_from_legal') {
      const returnedDate = toDateStr(iso);
      if (!returnedDate) { skipped++; continue; }
      const dedupKey = `juro-act-ret:${actorEmail.toLowerCase()}:${atMs}:${slugify((actionLine || '').slice(0, 120))}`.replace(/-+$/, '');

      if (dryRun) {
        eventsLogged++;
        continue;
      }
      if (await kv.sismember('import:event_dedup', dedupKey)) {
        skipped++;
        continue;
      }

      const returnedTo = recipientHint
        ? firstName(String(recipientHint), '')
        : null;

      const entry = {
        contractId: id,
        contractName: name,
        counterparty,
        importGroupKey,
        documentTitleRaw: String(documentTitle || '').slice(0, 2000),
        atMs,
        sentBy: null,
        sentToElaine: null,
        sentAt: null,
        returnedDate,
        returnedAt: formatTs(iso),
        returnedTo,
        isOpen: false,
        activityEvent: true,
        importRole: 'return_from_legal',
        source: 'juro-activity',
        actorEmail: actorEmail.toLowerCase(),
        actionLine: (actionLine || '').slice(0, 2000),
        templateLabel: (templateLabel || '').slice(0, 500),
        loggedAt: new Date().toISOString(),
        juroUrl: 'https://app.juro.com',
      };

      await kv.zadd('import:event_log', { score: atMs, member: JSON.stringify(entry) });
      await kv.sadd('import:event_dedup', dedupKey);
      const ids = (await kv.get('import:contract_ids')) || [];
      if (!ids.includes(id)) await kv.set('import:contract_ids', [...ids, id]);
      eventsLogged++;
      continue;
    }

    const sentToElaine = toDateStr(iso);
    if (!sentToElaine) { skipped++; continue; }
    const dedupKey = `juro-act:${actorEmail.toLowerCase()}:${atMs}:${slugify((actionLine || '').slice(0, 120))}`.replace(/-+$/, '');

    if (dryRun) {
      eventsLogged++;
      continue;
    }
    if (await kv.sismember('import:event_dedup', dedupKey)) {
      skipped++;
      continue;
    }

    const entry = {
      contractId: id,
      contractName: name,
      counterparty,
      importGroupKey,
      documentTitleRaw: String(documentTitle || '').slice(0, 2000),
      atMs,
      sentBy: firstName('', actorEmail) || actorEmail.split('@')[0],
      sentToElaine,
      sentAt: formatTs(iso),
      returnedDate: null,
      returnedAt: null,
      returnedTo: null,
      isOpen: false,
      activityEvent: true,
      importRole: 'to_legal',
      source: 'juro-activity',
      actorEmail: actorEmail.toLowerCase(),
      actionLine: (actionLine || '').slice(0, 2000),
      templateLabel: (templateLabel || '').slice(0, 500),
      loggedAt: new Date().toISOString(),
      juroUrl: 'https://app.juro.com',
    };

    await kv.zadd('import:event_log', { score: atMs, member: JSON.stringify(entry) });
    await kv.sadd('import:event_dedup', dedupKey);
    const ids = (await kv.get('import:contract_ids')) || [];
    if (!ids.includes(id)) await kv.set('import:contract_ids', [...ids, id]);
    eventsLogged++;
  }
  await kv.set('last_updated', new Date().toISOString());
  return { eventsLogged, skipped, format: 'juro-activity' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-legal-paste-token');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkPasteAuth(req)) {
    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Set LEGAL_PASTE_TOKEN in Vercel and pass Authorization: Bearer <token> or ?token=',
    });
  }

  const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
  const b = getJsonBody(req);
  const raw = b?.text != null ? String(b.text) : b?.data != null ? String(b.data) : '';
  if (!raw || !String(raw).trim()) return res.status(400).json({ error: 'Missing text body' });

  const trimmed = String(raw).trim();
  let activityParsed = null;
  let rows = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      if (Array.isArray(j)) rows = parseJsonContracts(j);
      else if (j.contracts && Array.isArray(j.contracts)) rows = parseJsonContracts(j.contracts);
      else {
        return res.status(400).json({ error: 'expected top-level array or { "contracts": [...] }' });
      }
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid JSON' });
    }
  } else {
    if (looksLikeJuroActivity(String(raw))) {
      activityParsed = parseJuroActivityText(String(raw));
    }
    if (!activityParsed || !activityParsed.length) {
      try {
        rows = parseTsvTabular(String(raw));
      } catch (e) {
        activityParsed = parseJuroActivityText(String(raw));
        if (!activityParsed || !activityParsed.length) {
          return res.status(400).json({
            error: e.message || 'Not valid TSV. Paste Juro Activity (action, date, email) or add column headers.',
          });
        }
      }
    }
  }

  if (activityParsed && activityParsed.length) {
    const out = await writeActivityEvents(activityParsed, dryRun);
    return res.status(200).json({
      ok: true, dryRun, ...out, rows: activityParsed.length,
    });
  }

  if (!rows.length) {
    return res.status(400).json({
      error: 'No rows. Paste Juro Activity (action + date + email), JSON (contract turns), or TSV with contract + sent date.',
    });
  }

  const out = await writeRows(rows, dryRun);
  return res.status(200).json({ ok: true, dryRun, ...out, rows: rows.length });
};
