const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const JURO_BASE  = 'https://api.juro.com/v3';
const PAGE_SIZE  = 200;
const BATCH_SIZE = 10;
const BATCH_WAIT = 1100;
const CACHE_TTL  = 3600; // 1 hour
const SINCE      = '2026-01-01T00:00:00.000Z';

// Fields finance cares about, keyed by the Juro field title.
// weight: 'critical' = must-have for finance; 'important' = should-have.
const FIELD_SPECS = [
  { title: 'Counterparty Name',             weight: 'critical',  applies: 'all'        },
  { title: 'Counterparty Contact Name/Title', weight: 'important', applies: 'all'       },
  { title: 'Counterparty Email',            weight: 'important', applies: 'all'        },
  { title: 'Initial Authorized Users Fee',  weight: 'critical',  applies: 'order_form' },
  { title: 'Number of Authorized Users',    weight: 'critical',  applies: 'order_form' },
  { title: 'Payment Terms',                 weight: 'critical',  applies: 'order_form' },
  { title: 'Auto Renewal',                  weight: 'important', applies: 'order_form' },
  { title: 'Service(s)',                    weight: 'important', applies: 'order_form' },
  { title: 'Effective Date',                weight: 'critical',  applies: 'signed'     },
  { title: 'Agreement Effective Date',      weight: 'critical',  applies: 'signed'     },
  { title: 'End Date',                      weight: 'important', applies: 'signed'     },
  { title: 'Governing Law',                 weight: 'important', applies: 'all'        },
];

// Statuses that represent a fully executed document
const FULLY_SIGNED_STATUSES = new Set(['signed', 'fully signed', 'fully_signed', 'executed']);

function isOrderForm(template = '') {
  return /order form/i.test(template);
}

function isSigned(status = '') {
  return FULLY_SIGNED_STATUSES.has(status.toLowerCase());
}

function fieldValue(fields = [], title) {
  const f = fields.find(f => f.title?.toLowerCase() === title.toLowerCase());
  return f?.value ?? null;
}

function hasValue(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// Which FIELD_SPECS apply to this contract?
function applicableSpecs(contract) {
  return FIELD_SPECS.filter(spec => {
    if (spec.applies === 'all') return true;
    if (spec.applies === 'order_form') return isOrderForm(contract.template?.name);
    if (spec.applies === 'signed') return isSigned(contract.status);
    return false;
  });
}

async function juroGet(path) {
  const res = await fetch(`${JURO_BASE}${path}`, {
    headers: { 'x-api-key': process.env.JURO_API_KEY },
  });
  if (!res.ok) throw new Error(`Juro ${res.status} ${path}`);
  return res.json();
}

async function listAllIds() {
  const ids = [];
  let skip = 0;
  while (true) {
    const data = await juroGet(`/contracts?limit=${PAGE_SIZE}&skip=${skip}`);
    for (const c of data.contracts || []) {
      if (c.createdDate >= SINCE) ids.push(c.id);
    }
    // Stop if we've gone past Jan 1 (list is newest-first)
    const oldest = (data.contracts || []).at(-1)?.createdDate || '';
    if (oldest < SINCE || (data.contracts || []).length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return ids;
}

async function batchDetails(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(id => juroGet(`/contracts/${id}`)
        .then(d => d.contract)
        .catch(() => null))
    );
    results.push(...fetched.filter(Boolean));
    if (i + BATCH_SIZE < ids.length) await new Promise(r => setTimeout(r, BATCH_WAIT));
  }
  return results;
}

function analyzeContract(detail) {
  const fields    = detail.fields || [];
  const template  = detail.template?.name || '';
  const status    = detail.status || '';
  const specs     = applicableSpecs({ template: { name: template }, status });

  const fieldResults = {};
  let criticalMissing   = 0;
  let importantMissing  = 0;

  for (const spec of specs) {
    // Try both the primary title and any alias (Effective Date vs Agreement Effective Date)
    const val = fieldValue(fields, spec.title) ??
                (spec.title === 'Effective Date' ? fieldValue(fields, 'Agreement Effective Date') : null) ??
                (spec.title === 'Agreement Effective Date' ? fieldValue(fields, 'Effective Date') : null);

    const present = hasValue(val);
    fieldResults[spec.title] = { present, value: val, weight: spec.weight };
    if (!present && spec.weight === 'critical')   criticalMissing++;
    if (!present && spec.weight === 'important')  importantMissing++;
  }

  const totalApplicable = specs.length;
  const totalPresent    = Object.values(fieldResults).filter(f => f.present).length;
  const completeness    = totalApplicable > 0
    ? Math.round((totalPresent / totalApplicable) * 100)
    : 100;

  return {
    id:               detail.id,
    name:             detail.name,
    template,
    status,
    isSigned:         isSigned(status),
    isOrderForm:      isOrderForm(template),
    owner:            detail.owner?.name || detail.owner?.username || '',
    createdDate:      detail.createdDate?.slice(0, 10),
    updatedDate:      detail.updatedDate?.slice(0, 10),
    juroUrl:          detail.internalUrl || `https://app.juro.com/sign/${detail.id}`,
    fields:           fieldResults,
    completeness,
    criticalMissing,
    importantMissing,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.JURO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'JURO_API_KEY not set' });

  // Single-contract refresh: ?id=<contractId>
  const contractId = req.query?.id;
  if (contractId) {
    try {
      const data   = await juroGet(`/contracts/${contractId}`);
      const detail = data.contract || data;
      if (!detail || !detail.id) return res.status(404).json({ error: 'Contract not found' });
      const report = analyzeContract(detail);
      return res.status(200).json({ contract: report });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const bust = req.query?.refresh === 'true';

  // Return cached result if available and not busting
  if (!bust) {
    const cached = await kv.get('juro:hygiene:cache');
    if (cached) return res.status(200).json({ ...cached, cached: true });
  }

  try {
    const ids     = await listAllIds();
    const details = await batchDetails(ids);
    const reports = details.map(analyzeContract);

    // Aggregate stats
    const total        = reports.length;
    const signed       = reports.filter(r => r.isSigned);
    const orderForms   = reports.filter(r => r.isOrderForm);
    const signedWithGaps = signed.filter(r => r.criticalMissing > 0);

    // Field-level miss counts across all contracts
    const fieldMissCounts = {};
    for (const r of reports) {
      for (const [title, f] of Object.entries(r.fields)) {
        if (!f.present) {
          fieldMissCounts[title] = (fieldMissCounts[title] || 0) + 1;
        }
      }
    }

    // Status distribution
    const byStatus = {};
    for (const r of reports) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }

    // Template distribution
    const byTemplate = {};
    for (const r of reports) {
      const t = r.template || 'Unknown';
      byTemplate[t] = (byTemplate[t] || 0) + 1;
    }

    const payload = {
      scannedAt:         new Date().toISOString(),
      since:             SINCE.slice(0, 10),
      total,
      totalSigned:       signed.length,
      totalOrderForms:   orderForms.length,
      signedWithCriticalGaps: signedWithGaps.length,
      avgCompleteness:   Math.round(reports.reduce((a, r) => a + r.completeness, 0) / (total || 1)),
      byStatus,
      byTemplate,
      fieldMissCounts,
      contracts:         reports.sort((a, b) => {
        // Signed with critical gaps first, then by completeness asc
        if (a.isSigned && !b.isSigned) return -1;
        if (!a.isSigned && b.isSigned) return 1;
        return a.completeness - b.completeness;
      }),
    };

    await kv.set('juro:hygiene:cache', payload, { ex: CACHE_TTL });
    return res.status(200).json({ ...payload, cached: false });

  } catch (e) {
    console.error('[hygiene] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
