const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SHEET_ID = '1NSMijZuSiDZqvo9DKBP-xn7OxbjzDWqgc0diEa13_HY';
const ELAINE   = 'elaine@granola.so';

// Contracts to skip — test/demo entries
const SKIP = [
  /test contract for demo/i,
  /apple music/i,
  /nick enterprises/i,
  /camilla real estates/i,
  /example orderform/i,
  /legal demo/i,
  /test msa/i,
  /enterprise order form.*with slack$/i,
  /open space labs/i,
];

const MONTH = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

function parseDate(dateStr, timeStr) {
  const p = dateStr.trim().split(/\s+/);
  let day, mon, yr;
  if (p.length === 3) { day = +p[0]; mon = MONTH[p[1]]; yr = +p[2]; }
  else                { day = +p[0]; mon = MONTH[p[1]]; yr = 2026;   }
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(yr, mon - 1, day, hh, mm));
}

function toDateStr(d)  { return d.toISOString().slice(0, 10); }

function formatTs(d) {
  const day   = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

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
};
function firstName(email) { return EMAIL_NAMES[email] || email.split('@')[0]; }

// ── Name normalisation ──────────────────────────────────────────────────────
function normalizeName(raw) {
  let name = decodeURIComponent(raw)
    .replace(/_+/g, ' ')
    .replace(/\.(docx?|pdf)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  let m;

  // "Company, Granola …" / "Company + Granola …" / "Company & Granola …"
  m = name.match(/^(.+?)\s*[,+&]\s*Granola\b/i);
  if (m) return m[1].trim();

  // "Company - Granola …" (e.g. NEA - Granola - …)
  m = name.match(/^(.+?)\s*[-–]\s*Granola\b/i);
  if (m) return m[1].trim();

  // "Granola, Company" / "Granola + Company"
  m = name.match(/^Granola\s*[,+&]\s*(.+?)(?:\s*[-–(]|$)/i);
  if (m) {
    const candidate = m[1].trim();
    if (!/^(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?)$/i.test(candidate)) return candidate;
  }

  // Parenthetical company keyword: "(PCIG Comments)" / "(Tatari rev …)"
  m = name.match(/\(([A-Z][A-Za-z0-9 .&'-]{1,30}?)\s+(?:comments?|redlines?|rev\b|edits?|\d{1,2}[./])/i);
  if (m) return m[1].trim();

  // "Granola - DocType - Company …" (e.g. Granola - Enterprise Order Form - Mozilla …)
  m = name.match(/^Granola\s*[-–]\s*(?:Enterprise Order Form|Short Order Form|Order Form|MSA|MNDA|DPA|POC Agreement|Pilot|Platform Terms|Data Processing Addendum)\s*[-–]\s*(.+?)(?:\s*[-–(]|\s+\d|\s+[A-Z]{2,}|$)/i);
  if (m) return m[1].trim().split(/\s+/)[0];

  // "Granola DocType Company …" without dashes (e.g. "Granola AI Pilot Agreement Citadel Comments")
  m = name.match(/^Granola\s+(?:AI\s+Pilot\s+Agreement|Enterprise\s+Order\s+Form|Short\s+Order\s+Form|Order\s+Form|MSA|MNDA|DPA|POC\s+Agreement|Pilot\s+Agreement|Platform\s+Terms)\s+(.+?)(?:\s+(?:comments?|redlines?|rev\b|edits?|\d)|$)/i);
  if (m) return m[1].trim().split(/\s+/)[0];

  // "Granola_BCV_POC" / "Granola_BCV_MNDA" style (underscores already converted to spaces)
  m = name.match(/^Granola\s+(\w+)\s+(?:POC|MNDA|MSA|DPA|Pilot|Renewal)\b/i);
  if (m) {
    const candidate = m[1].trim();
    if (!/^(?:AI|Enterprise|Short|Data|Platform)\b/i.test(candidate)) return candidate;
  }

  // "Company Granola MSA/Type"
  m = name.match(/^(.+?)\s+Granola\s+(?:MSA|MNDA|DPA|Order|Enterprise|POC|Pilot|Renewal|Data)\b/i);
  if (m) return m[1].trim();

  // "Company  Granola …" — space-only separator (e.g. Sprout_Social__Granola after underscore decode)
  m = name.match(/^([^–-]+)\s+Granola\b/i);
  if (m) return m[1].trim();

  // "Granola - Company - …" where next segment isn't a doc-type keyword
  m = name.match(/^Granola\s*[-–]\s*(.+?)\s*[-–]/i);
  if (m) {
    const candidate = m[1].trim();
    if (!/^(?:Enterprise|Short|Order Form|MSA|MNDA|DPA|POC|Pilot|Platform|Data)\b/i.test(candidate))
      return candidate;
  }

  // Fallback: first segment before any separator
  return name.split(/\s*[-–(]/)[0].trim() || name;
}

function normalizeCounterparty(raw) {
  if (/enterprise order form/i.test(raw))   return 'Enterprise Order Form';
  if (/short order form/i.test(raw))        return 'Short Order Form';
  if (/order form/i.test(raw))              return 'Order Form';
  if (/\bMSA\b/i.test(raw))               return 'MSA';
  if (/\bMNDA\b/i.test(raw))              return 'MNDA';
  if (/\bDPA\b|data processing/i.test(raw)) return 'DPA';
  if (/poc agreement|poc\b/i.test(raw))    return 'POC Agreement';
  if (/pilot agreement|ai pilot/i.test(raw)) return 'AI Pilot Agreement';
  if (/renewal/i.test(raw))               return 'Renewal';
  if (/security/i.test(raw))              return 'Security Exhibit';
  if (/platform terms/i.test(raw))        return 'Platform Terms';
  if (/nda|non.?disclosure/i.test(raw))   return 'NDA';
  return 'Contract';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_SHEETS_API_KEY env var not set' });

  // ── Fetch sheet ────────────────────────────────────────────────────────────
  const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A:F?key=${encodeURIComponent(apiKey)}`;
  let values;
  try {
    const r = await fetch(sheetUrl);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Sheets API ${r.status}: ${body.slice(0, 200)}`);
    }
    ({ values } = await r.json());
  } catch (e) {
    console.error('[sync-sheet] fetch failed:', e.message);
    return res.status(502).json({ error: 'Sheet fetch failed', detail: e.message });
  }

  if (!values || values.length < 2) {
    return res.status(200).json({ ok: true, synced: 0, message: 'Sheet is empty' });
  }

  const rows = values.slice(1); // drop header row

  // ── Group events by contract name ─────────────────────────────────────────
  const byContract = {};
  for (const row of rows) {
    const [contractName, , , date, time, email] = row;
    if (!contractName || !date || !time || !email) continue;
    if (SKIP.some(p => p.test(contractName)))      continue;
    if (!email.endsWith('@granola.so'))             continue;

    if (!byContract[contractName]) byContract[contractName] = [];
    byContract[contractName].push({ date: date.trim(), time: time.trim(), email: email.trim().toLowerCase() });
  }

  // ── Sort chronologically ──────────────────────────────────────────────────
  for (const name in byContract) {
    byContract[name].sort((a, b) => parseDate(a.date, a.time) - parseDate(b.date, b.time));
  }

  // ── Build turns ───────────────────────────────────────────────────────────
  const contracts = [];
  const sheetIds  = [];

  for (const rawName in byContract) {
    const events = byContract[rawName];
    if (!events.some(e => e.email === ELAINE)) continue; // skip if Elaine never involved

    // Bucket events into minute-precision timestamps (handles simultaneous multi-approver events)
    const byTs = {};
    for (const evt of events) {
      const dt  = parseDate(evt.date, evt.time);
      const key = dt.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
      if (!byTs[key]) byTs[key] = { dt, emails: new Set() };
      byTs[key].emails.add(evt.email);
    }

    const slots   = Object.entries(byTs).sort(([a], [b]) => a.localeCompare(b));
    const turns   = [];
    let   openIdx = -1;

    for (const [, { dt, emails }] of slots) {
      const hasElaine = emails.has(ELAINE);
      const others    = [...emails].filter(e => e !== ELAINE);

      if (hasElaine) {
        // Elaine is in this slot → new turn opens
        turns.push({
          sentToElaine: toDateStr(dt),
          sentAt:       formatTs(dt),
          sentBy:       '',           // filled in below
          returnedDate: null,
          returnedAt:   null,
          returnedTo:   null,
        });
        openIdx = turns.length - 1;
      } else if (others.length > 0 && openIdx >= 0 && turns[openIdx].returnedDate === null) {
        // Non-Elaine slot with an open turn → close it
        turns[openIdx].returnedDate = toDateStr(dt);
        turns[openIdx].returnedAt   = formatTs(dt);
        turns[openIdx].returnedTo   = firstName(others[0]);
        openIdx = -1;
      }
    }

    // sentBy for turn N = returnedTo from turn N-1
    for (let i = 1; i < turns.length; i++) {
      if (turns[i - 1].returnedTo) turns[i].sentBy = turns[i - 1].returnedTo;
    }

    if (!turns.length) continue;

    const slug = slugify(rawName);
    const id   = `sheet-${slug}`;

    contracts.push({
      id,
      name:         normalizeName(rawName),
      counterparty: normalizeCounterparty(rawName),
      turns,
    });
    sheetIds.push(id);
  }

  // ── Persist to Redis ──────────────────────────────────────────────────────
  if (contracts.length) {
    await Promise.all(contracts.map(c => kv.set(`sheet:contract:${c.id}`, c)));
  }
  await kv.set('sheet:contract_ids', sheetIds);
  await kv.set('sheet:last_synced',  new Date().toISOString());
  await kv.set('last_updated',       new Date().toISOString());

  console.log(`[sync-sheet] synced ${contracts.length} contracts`);
  return res.status(200).json({
    ok:         true,
    synced:     contracts.length,
    lastSynced: new Date().toISOString(),
  });
};
