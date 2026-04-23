// One-time script: seeds historical Juro activity log into Redis.
// Run: node seed-history.js
// Requires .env.local with KV_REST_API_URL and KV_REST_API_TOKEN.

require('dotenv').config({ path: '.env.local' });
const { Redis } = require('@upstash/redis');
const fs = require('fs');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SOURCE_FILE = process.argv[2] ||
  '/Users/nifesimifolacoker/.claude/projects/-Users-nifesimifolacoker/bd4f35c4-e418-48ba-89da-af1336f7d987/tool-results/contract_turns_output.json';

const LEGAL_TEAM = new Set(['elaine@granola.so', 'julie@granola.so']);

// ─── Email → first name ───────────────────────────────────────────────────────
const EMAIL_NAMES = {
  'camilla@granola.so':    'Camilla',
  'fola@granola.so':       'Nifesimi',
  'ernesto@granola.so':    'Ernesto',
  'ryan@granola.so':       'Ryan',
  'palmer@granola.so':     'Palmer',
  'bob@granola.so':        'Bob',
  'julie@granola.so':      'Julie',
  'nicktaylor@granola.so': 'Nick',
  'will@granola.so':       'Will',
  'bardia@granola.so':     'Bardia',
  'zach@granola.so':       'Zach',
  'doug@granola.so':       'Doug',
  'elaine@granola.so':     'Elaine',
};
function firstName(email = '') {
  return EMAIL_NAMES[email.toLowerCase()] || email.split('@')[0];
}

// ─── Name normalisation (same logic as sync-juro.js) ─────────────────────────
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

  m = name.match(/^Platform Terms with\s+(.+?)(?:\s*,|\s*[-–]|$)/i);
  if (m) return m[1].trim().split(/\s*,/)[0].trim();

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
  if (/security exhibit/i.test(raw))       return 'Security Exhibit';
  if (/nda|non.?disclosure/i.test(raw))    return 'NDA';
  return 'Contract';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function toDateStr(iso) {
  return iso ? iso.slice(0, 10) : null;
}

function formatTs(iso) {
  if (!iso) return null;
  const d     = new Date(iso);
  if (isNaN(d)) return null;
  const day   = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Reading source file...');
  const raw     = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  console.log(`Loaded ${raw.length} contracts from source file`);

  const existingIds  = (await kv.get('juro:contract_ids')) || [];
  const allIds       = new Set(existingIds);
  const existingDedup = new Set(); // track dedup keys added this run

  let contractsWritten = 0;
  let eventsLogged     = 0;
  let skipped          = 0;

  for (const src of raw) {
    if (!src.turns || src.turns.length === 0) { skipped++; continue; }

    // Build contract record
    const name         = normalizeName(src.contractName);
    const counterparty = normalizeCounterparty(src.template || src.contractName);
    const id           = `hist-${slugify(src.contractName)}`;
    const juroUrl      = `https://app.juro.com`; // no specific ID available from activity log

    const turns = src.turns.map(t => ({
      sentToElaine: toDateStr(t.sentDate),
      sentAt:       formatTs(t.sentDate),
      sentBy:       firstName(t.sentBy),
      returnedDate: toDateStr(t.returnedDate),
      returnedAt:   formatTs(t.returnedDate),
      returnedTo:   t.returnedTo ? firstName(t.returnedTo) : null,
    }));

    // Skip if all turns have no valid date
    if (!turns.some(t => t.sentToElaine)) { skipped++; continue; }

    const record = { id, name, counterparty, turns, juroUrl, source: 'history' };

    // Write to juro:contract namespace (will be merged in contracts.js)
    await kv.set(`juro:contract:${id}`, record);
    allIds.add(id);
    contractsWritten++;

    // Write each turn as an event in juro:event_log sorted set
    for (const turn of turns) {
      const dedupKey = `${id}:${turn.sentToElaine || 'unknown'}`;
      if (existingDedup.has(dedupKey)) continue;

      const alreadySeen = await kv.sismember('juro:event_dedup', dedupKey);
      if (alreadySeen) continue;

      const eventTs = turn.sentToElaine ? new Date(turn.sentToElaine).getTime() : 0;

      const entry = {
        contractId:   id,
        contractName: name,
        counterparty,
        sentBy:       turn.sentBy,
        sentToElaine: turn.sentToElaine,
        sentAt:       turn.sentAt,
        returnedDate: turn.returnedDate,
        returnedAt:   turn.returnedAt,
        returnedTo:   turn.returnedTo,
        isOpen:       turn.returnedDate === null,
        source:       'history',
        loggedAt:     new Date().toISOString(),
      };

      await kv.zadd('juro:event_log', { score: eventTs, member: JSON.stringify(entry) });
      await kv.sadd('juro:event_dedup', dedupKey);
      existingDedup.add(dedupKey);
      eventsLogged++;
    }
  }

  // Update the contract IDs list
  await kv.set('juro:contract_ids', [...allIds]);
  await kv.set('last_updated', new Date().toISOString());

  console.log(`\nDone.`);
  console.log(`  Contracts written: ${contractsWritten}`);
  console.log(`  Events logged:     ${eventsLogged}`);
  console.log(`  Skipped (no turns): ${skipped}`);
  console.log(`  Total juro:contract_ids: ${allIds.size}`);
}

seed().catch(e => { console.error(e); process.exit(1); });
