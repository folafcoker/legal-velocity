// Canonical company name → lowercase fragments that identify it
// in either a Juro contract name or a Slack message.
// Order matters: put more specific terms before shorter ones to avoid
// false matches (e.g. "red ventures" before "red").
const ALIASES = [
  // ── Active / recent contracts ─────────────────────────────────────────────
  ['Harvey',          ['harvey']],
  ['Amplitude',       ['amplitude']],
  ['Flock Safety',    ['flock safety', 'flock']],
  ['JMI Equity',      ['jmi equity', 'jmi']],
  ['Figma',           ['figma']],
  ['Plaid',           ['plaid']],
  ['Federato',        ['federato']],
  ['Nebius',          ['nebius']],
  ['Sprout Social',   ['sprout social', 'sprout']],
  ['Glovo',           ['glovo']],
  ['Snowflake',       ['snowflake']],
  ['Dropbox',         ['dropbox']],
  ['Navan',           ['navan']],
  ['Meta',            ['meta']],
  ['Atlan',           ['atlan']],
  ['Four Kites',      ['four kites', 'fourkites']],
  ['Hiya',            ['hiya']],
  ['AlphaSense',      ['alphasense', 'alpha sense']],
  ['Bain',            ['bain']],
  ['Komodo Health',   ['komodo health', 'komodo']],
  ['Posthog',         ['posthog']],
  ['CharlesBank',     ['charlesbank', 'charles bank']],
  ['Optimizely',      ['optimizely']],
  ['Checkr',          ['checkr']],
  ['Gladly',          ['gladly']],
  ['PandaDoc',        ['pandadoc', 'panda doc']],
  ['Justworks',       ['justworks']],
  ['Chainguard',      ['chainguard']],
  ['Deerfield',       ['deerfield']],
  ['DevRev',          ['devrev', 'dev rev']],
  ['Tatari',          ['tatari']],
  ['Airtable',        ['airtable']],
  ['Docker',          ['docker']],
  ['Mozilla',         ['mozilla']],
  ['Pinterest',       ['pinterest']],
  ['Thumbtack',       ['thumbtack']],
  ['Barrenjoey',      ['barrenjoey']],
  ['G2',              ['g2']],
  ['NEA',             ['nea']],
  ['PCIG',            ['pcig']],
  ['9Fin',            ['9fin']],
  ['Axelera AI',      ['axelera ai', 'axelera']],
  ['BCV',             ['bcv']],
  ['Red Ventures',    ['red ventures', 'imagitas']],
  ['PagerDuty',       ['pagerduty', 'pager duty']],
  ['a16z',            ['a16z']],
  ['AssemblyAI',      ['assemblyai', 'assembly ai']],
  ['Astronomer',      ['astronomer']],
  ['Citadel',         ['citadel']],
  ['Customer.io',     ['customer.io', 'customer io']],
  ['M&G',             ['m&g', 'm & g', 'mg granola']],
  ['Teramind',        ['teramind']],
  ['K1',              ['k1']],
  ['Pinterest',       ['pinterest']],
];

/**
 * Given any free-form text (Slack message or Juro contract name),
 * return the canonical company name or null if no alias matches.
 */
function resolveCompany(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [canonical, terms] of ALIASES) {
    if (terms.some(term => t.includes(term))) return canonical;
  }
  return null;
}

module.exports = { ALIASES, resolveCompany };
