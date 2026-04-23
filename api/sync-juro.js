const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const JURO_BASE   = 'https://api.juro.com/v3';
const PAGE_SIZE   = 200;
// Elaine and Julie together constitute the legal team.
// A turn spans the entire time the contract is within this set.
const LEGAL_TEAM  = new Set(['elaine@granola.so', 'julie@granola.so']);
const BATCH_SIZE = 10;   // concurrent detail fetches per round
const BATCH_WAIT = 1100; // ms between batches — keeps us under 10 req/s

// ─── Juro API ─────────────────────────────────────────────────────────────────

async function juroGet(path) {
  const res = await fetch(`${JURO_BASE}${path}`, {
    headers: { 'x-api-key': process.env.JURO_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Juro ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listContractIds(since) {
  const ids = [];
  let skip = 0;
  const sinceParam = since ? `&updatedSince=${encodeURIComponent(since)}` : '';
  while (true) {
    const data = await juroGet(`/contracts?limit=${PAGE_SIZE}&skip=${skip}${sinceParam}`);
    for (const c of (data.contracts || [])) ids.push(c.id);
    if (ids.length >= data.total || (data.contracts || []).length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return ids;
}

async function fetchDetail(id) {
  const data = await juroGet(`/contracts/${id}`);
  return data.contract;
}

async function batchFetchDetails(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(id => fetchDetail(id).catch(e => {
        console.warn(`[sync-juro] failed ${id}:`, e.message);
        return null;
      }))
    );
    results.push(...fetched.filter(Boolean));
    if (i + BATCH_SIZE < ids.length) {
      await new Promise(r => setTimeout(r, BATCH_WAIT));
    }
  }
  return results;
}

// ─── Normalisation (kept in sync with webhook.js) ────────────────────────────

function smartfield(fields = [], ...titles) {
  for (const title of titles) {
    const f = fields.find(f => (f.title || '').toLowerCase() === title.toLowerCase());
    if (f && f.value != null && f.value !== '') return String(f.value);
  }
  return null;
}

function normalizeName(title = '') {
  let name = title.replace(/\.docx?$/i, '').replace(/\.pdf$/i, '').trim();
  let m;

  m = name.match(/^(.+?)\s*[,+&]\s*Granola\b/i);
  if (m) return m[1].trim();

  m = name.match(/^(.+?)\s*[-–]\s*Granola\b/i);
  if (m) return m[1].trim();

  m = name.match(/^Granola\s*[,+&]\s*(.+?)(?:\s*[-–(]|$)/i);
  if (m) {
    const cand = m[1].trim();
    if (!/^(?:Inc\.?|LLC|Ltd\.?|Corp\.?)$/i.test(cand)) return cand;
  }

  m = name.match(/\(([A-Z][A-Za-z0-9 .&'-]{1,30}?)\s+(?:comments?|redlines?|rev\b|edits?)/i);
  if (m) return m[1].trim();

  m = name.match(/^Granola\s*[-–]\s*(?:Enterprise Order Form|Short Order Form|Order Form|MSA|MNDA|DPA|POC Agreement|Pilot|Platform Terms|Data Processing Addendum)\s*[-–]\s*(.+?)(?:\s*[-–(]|\s+\d|$)/i);
  if (m) return m[1].trim().split(/\s+/)[0];

  m = name.match(/^Granola\s+(?:AI\s+Pilot\s+Agreement|Enterprise\s+Order\s+Form|Short\s+Order\s+Form|Order\s+Form|MSA|MNDA|DPA|POC\s+Agreement|Pilot\s+Agreement|Platform\s+Terms)\s+(.+?)(?:\s+(?:comments?|redlines?|rev\b|edits?|\d)|$)/i);
  if (m) return m[1].trim().split(/\s+/)[0];

  m = name.match(/^Granola\s+(\w+)\s+(?:POC|MNDA|MSA|DPA|Pilot|Renewal)\b/i);
  if (m) {
    const cand = m[1].trim();
    if (!/^(?:AI|Enterprise|Short|Data|Platform)\b/i.test(cand)) return cand;
  }

  m = name.match(/^(.+?)\s+Granola\s+(?:MSA|MNDA|DPA|Order|Enterprise|POC|Pilot|Renewal|Data)\b/i);
  if (m) return m[1].trim();

  m = name.match(/^Granola\s*[-–]\s*(.+?)\s*[-–]/i);
  if (m) {
    const cand = m[1].trim();
    if (!/^(?:Enterprise|Short|Order Form|MSA|MNDA|DPA|POC|Pilot|Platform|Data)\b/i.test(cand))
      return cand;
  }

  return name.split(/\s*[-–(]/)[0].trim() || name;
}

function normalizeCounterparty(raw = '') {
  if (/enterprise order form/i.test(raw))    return 'Enterprise Order Form';
  if (/short order form/i.test(raw))         return 'Short Order Form';
  if (/order form/i.test(raw))              return 'Order Form';
  if (/\bMSA\b/i.test(raw))                return 'MSA';
  if (/\bMNDA\b/i.test(raw))               return 'MNDA';
  if (/\bDPA\b|data processing/i.test(raw)) return 'DPA';
  if (/poc agreement|poc\b/i.test(raw))     return 'POC Agreement';
  if (/pilot agreement|ai pilot/i.test(raw)) return 'AI Pilot Agreement';
  if (/renewal/i.test(raw))                return 'Renewal';
  if (/platform terms/i.test(raw))         return 'Platform Terms';
  if (/nda|non.?disclosure/i.test(raw))    return 'NDA';
  return raw || 'Contract';
}

function toDateStr(iso) { return new Date(iso).toISOString().slice(0, 10); }

function formatTs(iso) {
  const d     = new Date(iso);
  const day   = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

function firstName(nameStr = '', emailStr = '') {
  if (nameStr)  return nameStr.split(/\s+/)[0];
  if (emailStr) return emailStr.split('@')[0];
  return '';
}

// ─── Build contract record from Juro detail ───────────────────────────────────
//
// A turn = the time a contract spends within the legal team (Elaine + Julie).
//
// Rules applied to state.approval.approvers:
//  1. Find the contiguous block of LEGAL_TEAM approvers in the chain.
//  2. Turn OPEN  — any legal-team member in the block has "waiting for approval".
//  3. Turn CLOSED — all legal-team members approved/acted; a non-legal approver
//     follows the block (or the contract is fully approved).
//  4. Elaine ↔ Julie internal routing stays inside the block; it does NOT
//     open or close a separate turn.
//
// Timestamp note: Juro exposes createdDate / updatedDate at contract level only,
// not per approver step. We approximate:
//   sentToElaine ≈ createdDate   (contract created / sent for first approval)
//   returnedDate ≈ updatedDate   (last modification — when legal acted)
// Real-time webhook events capture precise timestamps for new contracts.

function buildRecord(detail) {
  const approvers = detail.state?.approval?.approvers || [];

  // Find the contiguous legal-team block
  const firstLegalIdx = approvers.findIndex(a => LEGAL_TEAM.has(a.username));
  if (firstLegalIdx === -1) return null; // no legal team involvement

  let lastLegalIdx = firstLegalIdx;
  while (
    lastLegalIdx + 1 < approvers.length &&
    LEGAL_TEAM.has(approvers[lastLegalIdx + 1].username)
  ) {
    lastLegalIdx++;
  }

  // Turn is open if any legal-team member is still pending
  const isOpen = approvers
    .slice(firstLegalIdx, lastLegalIdx + 1)
    .some(a => a.status === 'waiting for approval');

  // Who sent to the legal team: last non-legal approver before the block,
  // or the contract owner when legal is first in the chain.
  const prevApprover = firstLegalIdx > 0 ? approvers[firstLegalIdx - 1] : null;
  const sentBy = prevApprover
    ? firstName('', prevApprover.username)
    : firstName(detail.owner?.name, detail.owner?.username);

  // Who legal returned it to: first non-legal approver after the block.
  const nextApprover = approvers[lastLegalIdx + 1];
  const returnedTo   = (!isOpen && nextApprover) ? firstName('', nextApprover.username) : null;

  const turn = {
    sentToElaine: toDateStr(detail.createdDate),
    sentAt:       formatTs(detail.createdDate),
    sentBy,
    returnedDate: isOpen ? null : toDateStr(detail.updatedDate),
    returnedAt:   isOpen ? null : formatTs(detail.updatedDate),
    returnedTo,
  };

  const fields = detail.fields || [];

  return {
    id:             detail.id,
    name:           normalizeName(detail.name),
    counterparty:   normalizeCounterparty(detail.template?.name || detail.name),
    turns:          [turn],
    juroUrl:        detail.internalUrl || `https://app.juro.com/sign/${detail.id}`,
    priority:       smartfield(fields, 'Priority Level'),
    internalStatus: smartfield(fields, 'Internal Status'),
    owner:          detail.owner?.name || detail.owner?.username || '',
    status:         detail.status,
    updatedDate:    detail.updatedDate,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.JURO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'JURO_API_KEY not set' });

  // ?full=true forces a complete re-sync ignoring last_synced timestamp
  const forceFull  = req.query?.full === 'true';
  const lastSynced = forceFull ? null : await kv.get('juro:last_synced');
  const mode       = lastSynced ? 'incremental' : 'full';

  console.log(`[sync-juro] mode=${mode}${lastSynced ? ` since=${lastSynced}` : ''}`);

  try {
    // 1. Fetch contract IDs (paginated, filtered by updatedSince on incremental)
    const ids = await listContractIds(lastSynced);
    console.log(`[sync-juro] ${ids.length} contracts to inspect`);

    if (ids.length === 0) {
      await kv.set('juro:last_synced', new Date().toISOString());
      return res.status(200).json({ ok: true, synced: 0, total: 0, mode });
    }

    // 2. Fetch full details in rate-limited batches
    const details = await batchFetchDetails(ids);

    // 3. Filter to legal-team contracts and build records
    const records = details.map(buildRecord).filter(Boolean);
    console.log(`[sync-juro] ${records.length}/${ids.length} contracts involve legal team`);

    // 4. Load existing Juro contract IDs
    const existingIds = (await kv.get('juro:contract_ids')) || [];
    const allIds      = new Set(existingIds);
    const feedEvents  = [];
    let   loggedCount = 0;

    // 5. Persist records, detect state changes, and write to history log
    for (const record of records) {
      const contractKey  = `juro:contract:${record.id}`;
      const stateKey     = `juro:state:${record.id}`;
      const existing     = await kv.get(contractKey);
      const storedState  = await kv.get(stateKey);

      const turn         = record.turns[0];
      const isOpen       = turn.returnedDate === null;

      // Build a fingerprint of the current approval state for change detection
      const currentState = {
        isOpen,
        sentToElaine: turn.sentToElaine,
        returnedDate: turn.returnedDate,
        returnedTo:   turn.returnedTo,
        sentBy:       turn.sentBy,
      };
      const stateChanged = !storedState ||
        storedState.isOpen      !== currentState.isOpen ||
        storedState.sentToElaine !== currentState.sentToElaine;

      // ── History log ──────────────────────────────────────────────────────────
      // Write to juro:event_log (sorted set, score = ms timestamp) on first
      // detection of an approval event, and whenever state changes.
      // Dedup key = contractId:sentToElaine to prevent duplicate entries for
      // the same turn even across multiple syncs.
      if (stateChanged) {
        const dedupKey  = `${record.id}:${turn.sentToElaine || 'unknown'}`;
        const alreadySeen = await kv.sismember('juro:event_dedup', dedupKey);

        if (!alreadySeen) {
          // Use sentToElaine date if available, otherwise now
          const eventTs  = turn.sentToElaine
            ? new Date(turn.sentToElaine).getTime()
            : Date.now();

          const historyEntry = {
            contractId:   record.id,
            contractName: record.name,
            counterparty: record.counterparty,
            owner:        record.owner,
            sentBy:       turn.sentBy,
            sentToElaine: turn.sentToElaine,
            sentAt:       turn.sentAt,
            returnedDate: turn.returnedDate,
            returnedAt:   turn.returnedAt,
            returnedTo:   turn.returnedTo,
            isOpen,
            priority:     record.priority,
            juroUrl:      record.juroUrl,
            loggedAt:     new Date().toISOString(),
          };

          await kv.zadd('juro:event_log', {
            score:  eventTs,
            member: JSON.stringify(historyEntry),
          });
          await kv.sadd('juro:event_dedup', dedupKey);
          loggedCount++;
        }
      }

      // ── Feed events (recent activity stream) ─────────────────────────────────
      const hadOpenTurn = existing?.turns?.some(t => t.returnedDate === null);

      if (isOpen && !hadOpenTurn) {
        feedEvents.push({
          type:         'turn_opened',
          contractName: record.name,
          counterparty: record.counterparty,
          sentBy:       turn.sentBy || '',
          timestamp:    new Date().toISOString(),
        });
      } else if (!isOpen && hadOpenTurn) {
        feedEvents.push({
          type:         'turn_closed',
          contractName: record.name,
          counterparty: record.counterparty,
          returnedTo:   turn.returnedTo || '',
          timestamp:    new Date().toISOString(),
        });
      }

      // ── Persist current state ─────────────────────────────────────────────────
      await kv.set(contractKey, record);
      await kv.set(stateKey, currentState);
      allIds.add(record.id);
    }

    // 6. Publish feed events
    if (feedEvents.length) {
      for (const evt of feedEvents) await kv.lpush('feed', evt);
      await kv.ltrim('feed', 0, 49);
    }

    // 7. Update index and timestamps
    await kv.set('juro:contract_ids', [...allIds]);
    await kv.set('juro:last_synced', new Date().toISOString());
    await kv.set('last_updated', new Date().toISOString());

    return res.status(200).json({
      ok:        true,
      synced:    records.length,
      inspected: ids.length,
      logged:    loggedCount,
      mode,
      events:    feedEvents.length,
    });

  } catch (e) {
    console.error('[sync-juro] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
