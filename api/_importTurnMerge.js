const crypto = require('crypto');

/**
 * Stable id for a turn row in a group (out/in dates + who). Used to match and merge rows.
 * @param {object} t
 * @param {string} groupKey
 */
function fingerprintTurn(t, groupKey) {
  if (!t) return '';
  const s = [
    String(groupKey || ''),
    t.outDate || '',
    t.inDate || '',
    t.outAt && t.outAt !== '—' ? t.outAt : '',
    t.inAt && t.inAt !== '—' ? t.inAt : '',
    t.sentBy || '',
    t.returnedTo == null || t.returnedTo === '' ? '' : String(t.returnedTo),
    t.kind || '',
    t.stale ? '1' : '0',
  ].join('\x1e');
  return 't' + crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 20);
}

function outRankString(t) {
  return `${t && t.outDate ? t.outDate : '0000-00-00'}\x00${(t && t.outAt && t.outAt !== '—' ? t.outAt : '')}`;
}

/**
 * [earlier by out, later] by calendar out date + display out time
 */
function sortByOut(t1, t2) {
  if (outRankString(t1) <= outRankString(t2)) return [t1, t2];
  return [t2, t1];
}

function sameTurnShape(t1, t2) {
  return String(t1.outDate || '') === String(t2.outDate || '')
    && String(t1.inDate || '') === String(t2.inDate || '')
    && String(t1.outAt || '') === String(t2.outAt || '');
}

/**
 * Merge two displayed turns into one. Takes the **earlier** *out*; the *in* (return) prefers
 * the earlier full cycle, then the other (see branch order).
 * @param {(a:string,b:string) => number | null} [businessDaysCalc]
 */
function mergeTwoTurns(t1, t2, businessDaysCalc) {
  if (!t1 || !t2) throw new Error('Need two turns to merge');
  if (sameTurnShape(t1, t2)) {
    throw new Error('The two selected rows look identical; pick two different turn rows');
  }
  const [earlier, later] = sortByOut(t1, t2);
  let inDate = null;
  let inAt = null;
  let retTo = null;
  if (earlier.inDate && later.inDate) {
    inDate = earlier.inDate;
    inAt = earlier.inAt || null;
    retTo = earlier.returnedTo != null && earlier.returnedTo !== '' ? earlier.returnedTo : null;
  } else if (earlier.inDate) {
    inDate = earlier.inDate;
    inAt = earlier.inAt || null;
    retTo = earlier.returnedTo != null && earlier.returnedTo !== '' ? earlier.returnedTo : null;
  } else if (later.inDate) {
    inDate = later.inDate;
    inAt = later.inAt || null;
    retTo = later.returnedTo != null && later.returnedTo !== '' ? later.returnedTo : null;
  }
  const outDate = earlier.outDate || null;
  const outAt = (earlier.outAt && earlier.outAt !== '—' ? earlier.outAt : '—') || '—';
  const sentBy = (earlier.sentBy && String(earlier.sentBy) !== '—' ? earlier.sentBy : '—') || '—';
  const bd = businessDaysCalc && outDate && inDate
    ? businessDaysCalc(outDate, inDate)
    : null;
  return {
    source: (earlier.source && later.source ? [earlier.source, later.source] : [earlier.source, later.source])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(' + ') || '—',
    outDate,
    inDate,
    outAt,
    inAt: inAt || null,
    sentBy,
    returnedTo: retTo,
    businessDays: bd,
    kind: inDate ? 'complete' : (earlier.kind === 'activity' || later.kind === 'activity' ? 'activity' : 'open'),
    contractId: earlier.contractId || later.contractId,
    stale: (earlier.stale && later.stale) || false,
    manualMerge: true,
  };
}

/**
 * @param {object[]} turns
 * @param {string} groupKey
 */
function addTurnIds(turns, groupKey) {
  if (!turns || !turns.length) return [];
  return turns.map((t) => ({
    ...t,
    turnId: fingerprintTurn(t, groupKey),
  }));
}

/**
 * Apply stored merges: remove the two matching turnIds, insert merged.
 * @param {object[]} turns
 * @param {string} groupKey
 * @param {Array<{v:number,id:string,groupKey:string,fp1:string,fp2:string,merged:object,createdAt:string}>} records
 * @param {(a:string,b:string) => number | null} [businessDaysCalc]
 */
function applyTurnMerges(turns, groupKey, records, businessDaysCalc) {
  if (!turns || !turns.length || !records || !records.length) return turns;
  const forGroup = records
    .filter((r) => r && r.v === 1 && r.groupKey === groupKey && r.fp1 && r.fp2)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  let out = turns.map((t) => ({ ...t }));
  for (const m of forGroup) {
    const i1 = out.findIndex((t) => t && t.turnId === m.fp1);
    const i2 = out.findIndex((t) => t && t.turnId === m.fp2);
    if (i1 < 0 || i2 < 0 || i1 === i2) continue;
    const t1 = { ...out[i1] };
    const t2 = { ...out[i2] };
    delete t1.turnId;
    delete t1.mergeId;
    delete t2.turnId;
    delete t2.mergeId;
    let merged = m.merged && typeof m.merged === 'object'
      ? { ...m.merged, manualMerge: true }
      : mergeTwoTurns(t1, t2, businessDaysCalc);
    if (merged.outDate && merged.inDate && businessDaysCalc) {
      const bd = businessDaysCalc(merged.outDate, merged.inDate);
      if (bd != null) merged.businessDays = bd;
    }
    const rest = out.filter((_, i) => i !== i1 && i !== i2);
    merged = {
      ...merged,
      turnId: fingerprintTurn(merged, groupKey),
      mergeId: m.id,
    };
    out = [...rest, merged];
  }
  out.sort((a, b) => {
    const da = a.outDate || '';
    const db = b.outDate || '';
    return db.localeCompare(da);
  });
  return out;
}

module.exports = {
  fingerprintTurn,
  mergeTwoTurns,
  addTurnIds,
  applyTurnMerges,
};
