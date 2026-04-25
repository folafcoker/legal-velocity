/**
 * Group live webhook + Slack items by contract / company (token overlap + substring).
 */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'docx', 'pdf', 'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'order', 'form', 'template', 'customer', 'default', 'enterprise', 'short',
  'platform', 'terms', 'legal', 'granola', 'inc', 'llc', 'ltd', 'msa', 'dpa', 'mnda', 'nda', 'agreement', 'signed',
  'mutual', 'standard', 'security', 'exhibit', 'vendor', 'pilot', 'poc', 'copy', 'final', 'version', 'redline', 'rev',
  'party', 'third', 'data', 'processing', 'addendum', 'comments', 'edits', 'amendment', 'renewal', 'january', 'february',
]);

function norm(s) {
  return (s || '').toLowerCase().replace(/\.(docx?|pdf)\b/gi, ' ');
}

function needlesFrom(str) {
  const out = new Set();
  const n = norm(str);
  n.split(/[^a-z0-9+]+/g).forEach((t) => {
    if (t.length >= 3 && !STOP.has(t)) out.add(t);
  });
  // substrings 5+ chars (company names, "Figma", "Nebius")
  n.replace(/[^a-z0-9]+/gi, ' ').split(/\s+/).forEach((w) => {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  });
  return [...out];
}

function haystackForSlack(s) {
  return norm([s.title, s.rawText, s.meta].filter(Boolean).join(' '));
}

/**
 * @param {Array} webhooks - items with contractName, counterparty, title, at, …
 * @param {Array} slack - items with title, rawText, meta, at, …
 */
function groupLiveEvents(webhooks, slack) {
  const byKey = new Map();

  for (const w of webhooks) {
    const label = (w.contractName || w.counterparty || w.title || 'Contract').trim();
    const keyBase = label.replace(/\s+/g, ' ').slice(0, 80);
    let key = 'w:' + keyBase.toLowerCase().replace(/[^a-z0-9+]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    if (!key || key === 'w:') key = 'w:unknown-' + w.at;

    if (!byKey.has(key)) {
      const n = new Set(needlesFrom(w.contractName || ''));
      needlesFrom(w.counterparty || '').forEach((x) => n.add(x));
      needlesFrom(w.title || '').forEach((x) => n.add(x));
      byKey.set(key, {
        id: key,
        label,
        webhooks: [],
        slack: [],
        needles: n,
      });
    } else {
      const g = byKey.get(key);
      needlesFrom(w.contractName || '').forEach((x) => g.needles.add(x));
      needlesFrom(w.counterparty || '').forEach((x) => g.needles.add(x));
      needlesFrom(w.title || '').forEach((x) => g.needles.add(x));
    }
    byKey.get(key).webhooks.push(w);
  }

  const list = [...byKey.values()];
  const unmatched = [];

  for (const s of slack) {
    const h = haystackForSlack(s);
    let best = null;
    let bestScore = 0;
    for (const g of list) {
      let sc = 0;
      for (const needle of g.needles) {
        if (needle.length < 3) continue;
        if (h.includes(needle)) sc += needle.length >= 5 ? 3 : 1;
      }
      // direct label / contract phrase
      const lab = norm(g.label);
      if (lab.length > 4 && h.includes(lab.slice(0, Math.min(24, lab.length)))) sc += 5;
      if (sc > bestScore) {
        bestScore = sc;
        best = g;
      }
    }
    if (best && bestScore >= 1) {
      best.slack.push(s);
    } else {
      unmatched.push(s);
    }
  }

  for (const g of list) {
    g.lastAt = Math.max(
      ...[...g.webhooks, ...g.slack].map((x) => x.at || 0),
      0,
    );
  }

  const withUnmatched = [...list];
  if (unmatched.length) {
    withUnmatched.push({
      id: '_unmatched-slack',
      label: 'Slack (not linked to a Juro line in this window)',
      webhooks: [],
      slack: unmatched,
      needles: new Set(),
      lastAt: Math.max(...unmatched.map((s) => s.at || 0), 0),
    });
  }

  withUnmatched.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  return withUnmatched.map((g) => ({
    id: g.id,
    label: g.label,
    lastAt: g.lastAt,
    webhooks: g.webhooks,
    slack: g.slack,
  }));
}

module.exports = { groupLiveEvents, needlesFrom };
