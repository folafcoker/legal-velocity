/**
 * Collapse flat feed events (turn_opened / turn_closed / fully_approved) into
 * approval *pairs*: out for legal → back (or still open / orphan return in window).
 * Same contract key: normalized contractName + counterparty.
 */

function contractKey(e) {
  const n = (e.contractName || '').trim().toLowerCase();
  const c = (e.counterparty || '').trim().toLowerCase();
  return `${n}::${c}`;
}

/**
 * @param {Array<object>} raw - parsed feed objects with type, contractName, counterparty, timestamp, returnedTo (on close)
 * @returns {Array<{
 *   contractName: string,
 *   counterparty: string,
 *   out: object | null,
 *   returnEvent: object | null,
 *   lastAt: number,
 *   status: 'paired' | 'open' | 'orphan_in'
 * }>}
 */
function pairFeedTurns(raw) {
  const withT = raw
    .filter((e) => e && e.timestamp && e.type)
    .map((e) => ({ ...e, at: new Date(e.timestamp).getTime() }))
    .filter((e) => !isNaN(e.at));

  withT.sort((a, b) => a.at - b.at);

  const pending = new Map();
  const pairs = [];

  for (const e of withT) {
    const k = contractKey(e);
    if (e.type === 'turn_opened') {
      if (!pending.has(k)) pending.set(k, []);
      pending.get(k).push(e);
      continue;
    }
    if (e.type === 'turn_closed' || e.type === 'fully_approved') {
      const stack = pending.get(k);
      if (stack && stack.length) {
        const out = stack.shift();
        if (stack.length === 0) pending.delete(k);
        pairs.push({
          contractName: e.contractName || out.contractName,
          counterparty: e.counterparty || out.counterparty,
          out,
          returnEvent: e,
          lastAt: Math.max(out.at, e.at),
          status: 'paired',
        });
      } else {
        pairs.push({
          contractName: e.contractName,
          counterparty: e.counterparty,
          out: null,
          returnEvent: e,
          lastAt: e.at,
          status: 'orphan_in',
        });
      }
    }
  }

  for (const [, stack] of pending) {
    for (const out of stack) {
      pairs.push({
        contractName: out.contractName,
        counterparty: out.counterparty,
        out,
        returnEvent: null,
        lastAt: out.at,
        status: 'open',
      });
    }
  }

  pairs.sort((a, b) => b.lastAt - a.lastAt);
  return pairs;
}

function formatShort(iso, at) {
  try {
    const d = iso ? new Date(iso) : new Date(at);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/**
 * One display row for the live API / grouping (replaces per-event webhook lines).
 */
function pairToLiveRow(p) {
  const { contractName, counterparty, out, returnEvent, lastAt, status } = p;
  const name = contractName || 'Contract';
  const party = counterparty || '';

  let title;
  let subtitle;
  if (status === 'paired' && out && returnEvent) {
    const outS = formatShort(out.timestamp, out.at);
    const inS = formatShort(returnEvent.timestamp, returnEvent.at);
    if (returnEvent.type === 'turn_closed' && returnEvent.returnedTo) {
      title = `${name} — out ${outS} → back ${inS} (${returnEvent.returnedTo})`;
      subtitle = 'Sent to legal, then returned';
    } else if (returnEvent.type === 'turn_closed') {
      title = `${name} — out ${outS} → back ${inS}`;
      subtitle = 'Sent to legal, then returned';
    } else {
      title = `${name} — out ${outS} → fully approved ${inS}`;
      subtitle = 'Sent to legal, then fully approved';
    }
  } else if (status === 'open' && out) {
    const outS = formatShort(out.timestamp, out.at);
    const sent = out.sentBy ? ` · from ${out.sentBy}` : '';
    title = `${name} — out ${outS}${sent} (still with legal)`;
    subtitle = 'Not returned in this period';
  } else if (status === 'orphan_in' && returnEvent) {
    const inS = formatShort(returnEvent.timestamp, returnEvent.at);
    const ret = returnEvent.type === 'turn_closed' && returnEvent.returnedTo
      ? ` to ${returnEvent.returnedTo}` : (returnEvent.type === 'fully_approved' ? ' (fully approved)' : '');
    title = `${name} — return ${inS}${ret} (out before 7d window)`;
    subtitle = 'Return in window; start not in last 7 days';
  } else {
    title = name;
    subtitle = party;
  }

  return {
    source: 'webhook',
    at: lastAt,
    atIso: new Date(lastAt).toISOString(),
    kind: 'approval_pair',
    status,
    title,
    meta: party,
    contractName: name,
    counterparty: party,
    pairSubtitle: subtitle,
    outAt: out ? out.at : null,
    inAt: returnEvent ? returnEvent.at : null,
    rawText: [name, party, title, subtitle].filter(Boolean).join(' '),
  };
}

module.exports = { pairFeedTurns, pairToLiveRow, contractKey };
