/**
 * POST: merge two turn rows in the history view (same import contract group by turnId).
 * DELETE: remove a manual merge by id.
 */
const { Redis } = require('@upstash/redis');
const { mergeTwoTurns, fingerprintTurn } = require('./_importTurnMerge.js');
const crypto = require('crypto');

const MERGE_KEY = 'import:turn_merges';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

function getJsonBody(req) {
  const b = req.body;
  if (Buffer.isBuffer(b)) {
    try { return JSON.parse(b.toString('utf8')); }
    catch { return {}; }
  }
  if (typeof b === 'string') {
    try { return JSON.parse(b); }
    catch { return {}; }
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

async function loadMerges() {
  try {
    const raw = await kv.get(MERGE_KEY);
    if (raw == null) return [];
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

async function saveMerges(list) {
  await kv.set(MERGE_KEY, JSON.stringify(list));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-legal-paste-token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkPasteAuth(req)) {
    return res.status(401).json({ error: 'Paste token required' });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const { groupKey, turn1, turn2 } = body;
    if (!groupKey || typeof groupKey !== 'string') {
      return res.status(400).json({ error: 'groupKey (string) is required' });
    }
    if (!turn1 || !turn2 || typeof turn1 !== 'object' || typeof turn2 !== 'object') {
      return res.status(400).json({ error: 'turn1 and turn2 objects are required' });
    }
    if (turn1.manualMerge || turn2.manualMerge) {
      return res.status(400).json({ error: 'Unmerge a manual turn first; those rows are already a merge' });
    }
    for (const t of [turn1, turn2]) {
      if (!t.turnId || typeof t.turnId !== 'string') {
        return res.status(400).json({ error: 'Each turn must include turnId from the history list' });
      }
      if (fingerprintTurn(t, groupKey) !== t.turnId) {
        return res.status(400).json({ error: 'turnId does not match the row; reload history and try again' });
      }
    }
    if (turn1.turnId === turn2.turnId) {
      return res.status(400).json({ error: 'Pick two different turn rows' });
    }
    const strip = (t) => {
      const o = { ...t };
      delete o.turnId;
      delete o.mergeId;
      return o;
    };
    let merged;
    try {
      merged = mergeTwoTurns(strip(turn1), strip(turn2), null);
    } catch (e) {
      return res.status(400).json({ error: (e && e.message) || 'Could not merge' });
    }
    const id = `m${crypto.randomBytes(10).toString('hex')}`;
    const [fp1, fp2] = [turn1.turnId, turn2.turnId].sort();
    const record = {
      v: 1,
      id,
      groupKey,
      fp1,
      fp2,
      merged: { ...merged, turnId: undefined, mergeId: undefined, manualMerge: true },
      createdAt: new Date().toISOString(),
    };
    const list = await loadMerges();
    if (list.some((r) => r && r.v === 1 && r.groupKey === groupKey && r.fp1 === fp1 && r.fp2 === fp2)) {
      return res.status(200).json({ ok: true, already: true, groupKey, fp1, fp2 });
    }
    list.push(record);
    await saveMerges(list);
    return res.status(200).json({ ok: true, id, record });
  }

  if (req.method === 'DELETE') {
    const body = getJsonBody(req);
    const id = (body && body.id) || (req.query && req.query.id);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const list = (await loadMerges()).filter((r) => r && r.id !== id);
    await saveMerges(list);
    return res.status(200).json({ ok: true, removed: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
