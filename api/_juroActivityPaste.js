/**
 * Parse Juro "Activity" table paste: each turn is a triple (same for every "sent for approval" row):
 *   1) Action line: "{Name} sent for approval {Template name} with {contract filename}…"
 *   2) When:  "24 Apr 23:44" or "21 Nov 2025 14:11"
 *   3) Who took the action: that person’s work email
 *
 * Juro only surfaces "sent for approval" in the UI. We infer workflow:
 *   - Commercial (name + email not legal) → to legal → **opens** a turn.
 *   - Elaine or Julie in the *action* (first name) → from legal → **closes** a turn.
 *
 * The third line is the actor, but in some exports a deal-legal or owner copy still appears there.
 * When the action line clearly names a *commercial* sender, that wins over a legal email on line 3.
 */

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Email still used when the action line is missing the usual "Name sent for approval …" shape.
const LEGAL_TEAM_EMAILS = new Set([
  'elaine@granola.so',
  'julie@granola.so',
]);

const NOISE = new Set([
  'table view actions', 'juro logo', 'home', 'workspaces', 'ai review', 'activity',
  'granola', '23 members', 'documents', 'all', 'to do', '2', 'my documents', 'archive', 'views',
  'legal queue', 'under legal review', 'template customer view', 'duplicated enterprise order forms',
  'show more', 'folders', 'templates', 'automations', 'integrations', 'bulk actions',
  'contract reader', 'reports', 'reminders', 'settings', 'profile', 'notification settings',
  "you're viewing", 'filtered by', 'all users', 'what', 'when', 'who', 'email',
  '[object object]', 'table view', 'search',
]);

function isNoise(s) {
  const t = s.trim().toLowerCase();
  if (t.length < 2) return true;
  if (NOISE.has(t)) return true;
  if (/^members$|^archive$/i.test(t)) return true;
  return false;
}

const EMAIL_RE = /^[^\s<]+@[^\s>]+$/;

function parseEmailLine(line) {
  const s = line.trim();
  return EMAIL_RE.test(s) ? s : null;
}

/**
 * "24 Apr 23:44" or "21 Nov 2025 14:11"
 */
function parseDateLine(s) {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})$/i);
  if (m) {
    const d = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon == null) return null;
    const y = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    return { hasYear: true, ms: Date.UTC(y, mon, d, hh, min, 0, 0) };
  }
  m = t.match(/^(\d{1,2})\s+(\w{3})\s+(\d{1,2}):(\d{2})$/i);
  if (m) {
    const d = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon == null) return null;
    const hh = parseInt(m[3], 10);
    const min = parseInt(m[4], 10);
    return { hasYear: false, d, mon, hh, min };
  }
  return null;
}

function toUtcFromParts(p, y) {
  if (p.hasYear) return p.ms;
  return Date.UTC(y, p.mon, p.d, p.hh, p.min, 0, 0);
}

const SENT_FOR = /sent for approval/i;

/** Split "… sent for approval TEMPLATE with DOC" using the *last* " with " (handles "… with … with file.docx"). */
function splitActionLine(action) {
  const m = action.match(/^(.+?)\s+sent for approval\s+(.+)$/i);
  if (!m) return { actorPart: '', templateLabel: action, documentTitle: action };
  const after = m[2].trim();
  const last = after.toLowerCase().lastIndexOf(' with ');
  if (last === -1) {
    return { actorPart: m[1].trim(), templateLabel: after, documentTitle: after };
  }
  return {
    actorPart: m[1].trim(),
    templateLabel: after.slice(0, last).trim(),
    documentTitle: after.slice(last + 6).trim(),
  };
}

function isLegalTeamEmail(email) {
  if (!email) return false;
  return LEGAL_TEAM_EMAILS.has(String(email).trim().toLowerCase());
}

/** True if the *actor* in “{Name} sent for approval …” is legal (first name before the phrase, e.g. "Elaine Foreman"). */
function isLegalActorFromActionLine(actorPart) {
  if (!actorPart) return false;
  const first = String(actorPart)
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
  return first === 'elaine' || first === 'julie';
}

/** True when the line matches the usual "… sent for …" shape (name + template, per Juro copy). */
function hasActorBeforeSentForApproval(action) {
  return /^(.+?)\s+sent for approval\b/i.test(String(action).trim());
}

/**
 * True when this *sent for approval* line is legal sending onward (closes a turn).
 * Prefer the **{Name}** in "Elaine Foreman sent for approval …" over the third line:
 * a commercial row can still list elaine@ on the deal-owner / CC line in some exports.
 */
function isLegalCloserAction(action, email) {
  const t = String(action).trim();
  if (!SENT_FOR.test(t)) return false;
  if (/^(elaine|julie)\s+sent\s+for\s+approval\b/i.test(t)) return true;
  if (/\bsent\s+for\s+approval\s+from\s+(elaine|julie)\b/i.test(t)) return true;

  const { actorPart } = splitActionLine(t);
  const hasNamedActor = hasActorBeforeSentForApproval(t) && String(actorPart).length > 0;
  if (hasNamedActor) {
    if (isLegalActorFromActionLine(actorPart)) return true;
    // e.g. "Palmer … sent for approval" + elaine@ on line 3 → still commercial (deal-owner email)
    return false;
  }

  // Atypical lines (no "Name + template" parse): use embedded email/phrase heuristics, then line-3
  if (
    /\b(elaine|julie)@granola\.so[^\n]{0,200}sent\s+for\s+approval/i.test(t)
    && !/\bto\s+(elaine|julie)@granola\.so[^\n]{0,200}sent\s+for\s+approval/i.test(t)
  ) {
    return true;
  }
  if (isLegalTeamEmail(email)) return true;
  if (isLegalActorFromActionLine(actorPart)) return true;
  return false;
}

/**
 * Optional: "… sent for approval to Nifesimi …" → recipient name for close events.
 */
function parseSentForApprovalRecipientName(action) {
  const m = action.match(/\bsent for approval\s+to\s+([^,\n(]+?)(?:\s+with\s|\s*$)/i);
  if (!m) return null;
  return m[1].trim().split(/\s+/)[0] || null;
}

/**
 * @returns {Array<{
 *   actionLine: string, atMs: number, actorEmail: string, templateLabel: string, documentTitle: string,
 *   role: 'to_legal' | 'return_from_legal'
 * }>}
 */
function parseJuroActivityText(text) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = rawLines.filter((l) => !isNoise(l) && l.toLowerCase() !== 'activity');

  const triples = [];
  for (let i = 0; i < lines.length - 2; i += 1) {
    const action = lines[i];
    const dateLine = lines[i + 1];
    const emLine = lines[i + 2];
    if (!SENT_FOR.test(action)) continue;
    const em = parseEmailLine(emLine);
    if (!em) continue;
    const dparse = parseDateLine(dateLine);
    if (!dparse) continue;
    const role = isLegalCloserAction(action, em) ? 'return_from_legal' : 'to_legal';
    triples.push({ action, dparse, email: em, role });
    i += 2;
  }

  if (!triples.length) return [];

  const defaultYear = new Date().getUTCFullYear();
  let prevMs = null;
  for (const t of triples) {
    if (t.dparse.hasYear) {
      t.atMs = t.dparse.ms;
      prevMs = t.atMs;
      continue;
    }
    let y = defaultYear;
    let ms = toUtcFromParts(t.dparse, y);
    if (prevMs != null) {
      const yMax = defaultYear + 2;
      while (y < yMax && ms < prevMs) {
        y += 1;
        ms = toUtcFromParts(t.dparse, y);
      }
    }
    t.atMs = ms;
    prevMs = t.atMs;
  }

  const out = [];
  for (const t of triples) {
    if (!SENT_FOR.test(t.action)) continue;
    const { templateLabel, documentTitle } = splitActionLine(t.action);
    out.push({
      actionLine: t.action,
      atMs: t.atMs,
      actorEmail: t.email,
      templateLabel,
      documentTitle: documentTitle || t.action,
      role: t.role,
      /** When legal sends for approval, optional parsed next recipient (not the legal actor). */
      recipientHint: t.role === 'return_from_legal' ? parseSentForApprovalRecipientName(t.action) : null,
    });
  }
  return out;
}

function looksLikeJuroActivity(text) {
  if (!text || text.length < 80) return false;
  const t = String(text);
  if ((t.match(/@/g) || []).length < 2) return false;
  if (!/sent for approval/i.test(t)) return false;
  if (/^\s*[\[{\s]/.test(t) && /"contractname"/i.test(t)) return false;
  if (/\t/.test(t.split('\n').slice(0, 3).join('\n')) && /contract|sent|date/i.test(t.slice(0, 500))) {
    if (!/sent for approval/i.test(t)) return true;
  }
  return true;
}

module.exports = {
  parseJuroActivityText,
  looksLikeJuroActivity,
  parseDateLine,
  splitActionLine,
  isLegalTeamEmail,
  isLegalActorFromActionLine,
  isLegalCloserAction,
  LEGAL_TEAM_EMAILS,
};
