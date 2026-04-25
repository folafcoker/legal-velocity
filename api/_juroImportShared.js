// Shared normalizers + turn shaping for juro-paste and seed-style JSON imports.

const LEGAL_NAMES = {
  'camilla@granola.so': 'Camilla', 'fola@granola.so': 'Nifesimi', 'ernesto@granola.so': 'Ernesto',
  'ryan@granola.so': 'Ryan', 'palmer@granola.so': 'Palmer', 'bob@granola.so': 'Bob',
  'julie@granola.so': 'Julie', 'nicktaylor@granola.so': 'Nick', 'will@granola.so': 'Will',
  'bardia@granola.so': 'Bardia', 'zach@granola.so': 'Zach', 'doug@granola.so': 'Doug',
  'elaine@granola.so': 'Elaine',
};

function firstName(nameStr = '', emailStr = '') {
  if (emailStr && LEGAL_NAMES[emailStr.toLowerCase()]) return LEGAL_NAMES[emailStr.toLowerCase()];
  if (nameStr) return nameStr.split(/\s+/)[0];
  if (emailStr) return emailStr.split('@')[0];
  return '';
}

function normalizeName(title = '') {
  let name = (title || '').replace(/\.docx?$/i, '').replace(/\.pdf$/i, '').trim();
  let m = name.match(/^(.+?)\s*[,+&]\s*Granola\b/i);
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
  return name.split(/\s*[-–(]/)[0].trim() || name;
}

function normalizeCounterparty(raw = '') {
  if (/enterprise order form/i.test(raw)) return 'Enterprise Order Form';
  if (/short order form/i.test(raw)) return 'Short Order Form';
  if (/order form/i.test(raw)) return 'Order Form';
  if (/\bMSA\b/i.test(raw)) return 'MSA';
  if (/\bMNDA\b/i.test(raw)) return 'MNDA';
  if (/\bDPA\b|data processing/i.test(raw)) return 'DPA';
  if (/poc agreement|poc\b/i.test(raw)) return 'POC Agreement';
  if (/pilot agreement|ai pilot/i.test(raw)) return 'AI Pilot Agreement';
  if (/renewal/i.test(raw)) return 'Renewal';
  if (/platform terms/i.test(raw)) return 'Platform Terms';
  if (/security exhibit/i.test(raw)) return 'Security Exhibit';
  if (/nda|non.?disclosure/i.test(raw)) return 'NDA';
  return 'Contract';
}

function slugify(str) {
  return String(str || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function toDateStr(iso) {
  if (!iso) return null;
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (d instanceof Date && !isNaN(d)) return d.toISOString().split('T')[0];
  return null;
}

function formatTs(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const day = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

function parseDate(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  // ISO / YYYY-MM-DD first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  // Unambiguous: DD/MM/YYYY or DD-MM-YYYY (UK) before falling back to Date.parse
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 12));
    if (!isNaN(d)) return d;
  }
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2;
  return null;
}

/** @returns {string} ISO or null */
function toIsoFromCell(val) {
  const d = parseDate(val);
  return d && !isNaN(d) ? d.toISOString() : null;
}

const { splitActionLine } = require('./_juroActivityPaste.js');

/**
 * One stable key per logical document: stem of filename (strip version markers) + document
 * *type* bucket, so all Juro lines for the same contract file group (filenames can vary
 * with “ (1) (2) ”, etc. between activity rows).
 */
function stableImportGroupKey(documentTitle, templateLabel) {
  const type = normalizeCounterparty(
    [String(templateLabel || ''), String(documentTitle || '')].filter(Boolean).join(' '),
  );
  let stem = String(documentTitle || '')
    .replace(/\.(docx?|pdf)\s*$/i, '')
    .toLowerCase();
  stem = stem.replace(/\s*\(copy\)\s*$/i, '');
  stem = stem.replace(/(?:\s*\(\d+\))+\s*$/g, '');
  stem = stem
    .replace(/\b\d{1,2}-\d{1,2}-\d{4}_/gi, '')
    .replace(/\b\d{4}[_-]\d{1,2}[_-]\d{1,2}[_-]?/g, '');
  stem = stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem) stem = 'document';
  return `${stem.slice(0, 160)}||${type}`.toLowerCase();
}

/** @param {object} e - import event (optional importGroupKey / documentTitleRaw on new rows) */
function importGroupKeyFromEvent(e) {
  if (e.importGroupKey) return e.importGroupKey;
  let doc = '';
  if (e.documentTitleRaw && String(e.documentTitleRaw).trim()) {
    doc = String(e.documentTitleRaw);
  } else if (e.actionLine) {
    const s = splitActionLine(String(e.actionLine));
    if (s.documentTitle && s.documentTitle !== e.actionLine) doc = s.documentTitle;
  }
  if (!doc) doc = e.contractName || '';
  return stableImportGroupKey(doc, e.templateLabel);
}

module.exports = {
  firstName,
  normalizeName,
  normalizeCounterparty,
  stableImportGroupKey,
  importGroupKeyFromEvent,
  slugify,
  toDateStr,
  formatTs,
  parseDate,
  toIsoFromCell,
  LEGAL_NAMES,
};
