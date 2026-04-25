const { Redis } = require('@upstash/redis');
const { resolveCompany } = require('./_aliases');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── Filter helpers ────────────────────────────────────────────────────────────

const SIGNED_STATUSES = new Set(['signed', 'fully_signed', 'countersigned']);

// Names that indicate test/demo/template noise rather than real contracts
const TEST_PATTERN = /\b(example|demo|nick enterprises|camilla real estates|apple music|open space labs|complyadvan|meesho)\b/i;

// Single-word or generic names that are Juro drafts/junk, not real contracts
const GENERIC_NAMES = new Set([
  'new', 'complete', 'enterprise', 'non', 'daily notes',
  'aipac', '2026aipacmnda',
]);

// Contracts whose names are just "Granola" or "Granola_" with no counterparty —
// these are raw Juro documents that weren't properly named
const BARE_GRANOLA = /^granola[_\s]*$/i;

// Vendor compliance forms Granola fills out as a *supplier* — not customer contracts.
// Normalise underscores → spaces before testing so filename-style names match.
// Keep DPAs/addenda that are part of customer negotiations (e.g. Navan DPA).
const SUPPLIER_FORM = /standard.supplier.security|supplier.security.requirements/i;

// Granola's own template documents / internal records with no external counterparty.
// "Platform Terms with ..." entries are unnamed template versions; "Granola, Inc." and
// "Granola Data Processing Addendum" are self-referential and can't be tracked by counterparty.
const INTERNAL_DOC = /^platform terms\b|^granola,?\s*inc\.?\s*$|^granola\s+data\s+processing\s+addendum\s*$/i;

function shouldInclude(c) {
  // Exclude by Juro status
  if (SIGNED_STATUSES.has((c.status || '').toLowerCase())) return false;
  if (c.fully_signed) return false;
  // Exclude test/demo noise
  if (TEST_PATTERN.test(c.name || '')) return false;
  if (GENERIC_NAMES.has((c.name || '').toLowerCase().trim())) return false;
  // Exclude bare "Granola" / "Granola_" entries (unnamed webhook documents)
  if (BARE_GRANOLA.test((c.name || '').trim())) return false;
  // Exclude vendor compliance forms (e.g. Dropbox Standard Supplier Security Requirements)
  const normName = (c.name || '').replace(/_/g, ' ');
  if (SUPPLIER_FORM.test(normName)) return false;
  // Exclude Granola's own template/internal documents with no identifiable counterparty
  if (INTERNAL_DOC.test(normName.trim())) return false;
  // Exclude empty contracts (0 turns, no approval data)
  if (!c.turns || c.turns.length === 0) return false;
  return true;
}

// ── Deduplication by canonical company name ───────────────────────────────────
//
// Both Juro API and webhook sources can have separate records for the same
// company (e.g. "Astronomer.io" from webhook + "Platform Terms with Astronomer.io"
// from Juro sync). Resolve both through the alias table and merge their turns.

function mergeTurns(a, b) {
  const all  = [...(a || []), ...(b || [])];
  const seen = new Set();
  return all
    .filter(t => {
      const key = `${t.sentToElaine}|${t.sentAt || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((x, y) => (x.sentToElaine || '').localeCompare(y.sentToElaine || ''));
}

function mergeRecords(a, b) {
  const turns = mergeTurns(a.turns, b.turns);
  // Prefer whichever has richer metadata (status, juroUrl, slackRequests)
  const base  = (a.status || a.juroUrl) ? a : b;
  const other = base === a ? b : a;
  return {
    ...other,
    ...base,
    turns,
    slackRequests: base.slackRequests || other.slackRequests || undefined,
    slackUrgency:  base.slackUrgency  || other.slackUrgency  || undefined,
  };
}

function deduplicateByCompany(contracts) {
  const byCanonical = new Map();
  const unresolved  = [];

  for (const c of contracts) {
    const canonical = resolveCompany(c.name || '');
    if (!canonical) {
      unresolved.push(c);
      continue;
    }
    byCanonical.set(
      canonical,
      byCanonical.has(canonical)
        ? mergeRecords(byCanonical.get(canonical), c)
        : { ...c, _canonical: canonical },
    );
  }

  // Use the canonical name as the display name for any entry that resolved.
  // This normalises raw Juro filenames (e.g. "Atlan_Order_Form GRANOLA MSA...") to "Atlan".
  const resolved = [...byCanonical.values()].map(c => ({ ...c, name: c._canonical }));
  return [...resolved, ...unresolved];
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const source = (req.query?.source || 'all').toLowerCase();
  const webhookOnly = source === 'webhook';

  // ── Fetch all ID lists in parallel ───────────────────────────────────────────
  const [juroIds, webhookIds, lastUpdated, juroLastSynced, slackRequests, slackLastSynced] = await Promise.all([
    webhookOnly ? Promise.resolve([]) : kv.get('juro:contract_ids').then(v => v || []),
    kv.get('contract_ids').then(v => v || []),
    kv.get('last_updated'),
    kv.get('juro:last_synced'),
    kv.get('slack:requests').then(v => v || []),
    kv.get('slack:last_synced'),
  ]);

  // ── Batch-fetch all contracts ─────────────────────────────────────────────────
  const juroKeys    = juroIds.map(id => `juro:contract:${id}`);
  const webhookKeys = webhookIds.map(id => `contract:${id}`);

  const [juroRaw, webhookRaw] = await Promise.all([
    juroKeys.length    ? kv.mget(...juroKeys)    : Promise.resolve([]),
    webhookKeys.length ? kv.mget(...webhookKeys) : Promise.resolve([]),
  ]);

  function unwrap(c) {
    if (!c) return null;
    if (c.value !== undefined && 'EX' in c) return c.value;
    return c;
  }

  const juroContracts    = juroRaw.map(unwrap).filter(c => c && c.name);
  const webhookContracts = webhookRaw.map(unwrap).filter(c => c && c.name);

  // ── Initial merge: webhook primary, Juro supplements ──────────────────────────
  // We keep webhooks as source-of-truth for freshness and only use Juro polling
  // to enrich/fill gaps.
  const merged = [...webhookContracts];

  for (const jc of juroContracts) {
    const jcTurns = jc.turns || [];
    const idx = merged.findIndex(c => c.id === jc.id || c.name === jc.name);
    if (idx >= 0) {
      const current = merged[idx];
      const currentTurns = current.turns || [];
      if (jcTurns.length > currentTurns.length) {
        merged[idx] = mergeRecords(current, jc);
      } else {
        merged[idx] = mergeRecords(jc, current);
      }
    } else {
      merged.push(jc);
    }
  }

  // ── Filter: remove signed, test/demo, and empty contracts ─────────────────────
  const filtered = merged.filter(shouldInclude);

  // ── Deduplicate: one record per canonical company name ────────────────────────
  const deduped = deduplicateByCompany(filtered);

  // ── Attach Slack context ──────────────────────────────────────────────────────
  const slackByCanonical = {};
  for (const req of slackRequests) {
    if (!req.contractHint) continue;
    (slackByCanonical[req.contractHint] = slackByCanonical[req.contractHint] || []).push(req);
  }

  const matchedCanonicals = new Set();
  const enriched = deduped.map(c => {
    const canonical = c._canonical || resolveCompany(c.name || '');
    const requests  = canonical ? (slackByCanonical[canonical] || []) : [];
    if (!requests.length) return c;

    matchedCanonicals.add(canonical);
    const topUrgency = requests.some(r => r.urgency === 'high')   ? 'high'
                     : requests.some(r => r.urgency === 'medium') ? 'medium'
                     : 'normal';
    return { ...c, slackRequests: requests, slackUrgency: topUrgency };
  });

  // Contracts mentioned in Slack but not yet tracked in Juro
  const unmatched = slackRequests.filter(
    r => r.contractHint && !matchedCanonicals.has(r.contractHint)
  );

  return res.status(200).json({
    contracts:       enriched,
    unmatchedSlack:  unmatched,
    lastUpdated:     lastUpdated     || null,
    lastSynced:      juroLastSynced  || null,
    slackLastSynced: slackLastSynced || null,
    dataSource:      webhookOnly ? 'webhook' : 'all',
  });
};
