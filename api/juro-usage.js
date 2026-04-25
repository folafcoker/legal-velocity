const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PAGE_SIZE = 200;
const MONTHLY_QUOTA = 30000;
const RPS_LIMIT = 10;
const RPS_BURST = 20;

function asDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function asMonthOnly(d) {
  return d.toISOString().slice(0, 7);
}

function estimateCallsPerRun(contractsCount) {
  const pages = Math.ceil(contractsCount / PAGE_SIZE);
  return pages + contractsCount;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const now = new Date();
  const month = asMonthOnly(now);
  const today = asDateOnly(now);
  const contractsCount = Number(req.query?.contracts || 350);
  const monthUsageKey = `juro:usage:month:${month}`;
  const todayUsageKey = `juro:usage:day:${today}`;

  const dayKeys = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    dayKeys.push(`juro:usage:day:${asDateOnly(d)}`);
  }

  const [monthUsageRaw, todayUsageRaw, recentDaysRaw] = await Promise.all([
    kv.get(monthUsageKey),
    kv.get(todayUsageKey),
    kv.mget(...dayKeys),
  ]);

  const monthUsage = monthUsageRaw || {
    calls: 0,
    listCalls: 0,
    detailCalls: 0,
    retries: 0,
    rateLimit429: 0,
    runs: 0,
    successfulRuns: 0,
    failedRuns: 0,
    lastRunAt: null,
    lastMode: null,
  };

  const todayUsage = todayUsageRaw || {
    calls: 0,
    listCalls: 0,
    detailCalls: 0,
    retries: 0,
    rateLimit429: 0,
    runs: 0,
    successfulRuns: 0,
    failedRuns: 0,
    lastRunAt: null,
    lastMode: null,
  };

  const recentDays = dayKeys.map((k, idx) => {
    const value = recentDaysRaw[idx];
    const date = k.slice('juro:usage:day:'.length);
    return { date, ...(value || { calls: 0, runs: 0, rateLimit429: 0 }) };
  });

  const monthCalls = monthUsage.calls || 0;
  const remaining = Math.max(0, MONTHLY_QUOTA - monthCalls);
  const monthlyPercent = Number(((monthCalls / MONTHLY_QUOTA) * 100).toFixed(2));
  const inferredStatus =
    monthCalls >= MONTHLY_QUOTA ? 'monthly_quota_exceeded' :
    (monthUsage.rateLimit429 || 0) > 0 ? 'throttling_detected' :
    'healthy';

  const callsPerFullRunEstimate = estimateCallsPerRun(contractsCount);
  const oldCadenceMonthlyEstimate = callsPerFullRunEstimate * 144 * 30; // 10-min cron cadence
  const newCadenceMonthlyEstimate = callsPerFullRunEstimate * 5; // weekly cadence (approx 5x/month)

  return res.status(200).json({
    now: now.toISOString(),
    contractsAssumption: contractsCount,
    limits: {
      monthlyQuota: MONTHLY_QUOTA,
      throttleRps: RPS_LIMIT,
      burst: RPS_BURST,
    },
    usage: {
      month,
      monthCalls,
      monthRemaining: remaining,
      monthPercentUsed: monthlyPercent,
      inferredStatus,
      monthUsage,
      todayUsage,
      recentDays,
    },
    math: {
      pageSize: PAGE_SIZE,
      estimatedCallsPerFullRun: callsPerFullRunEstimate,
      oldCadence: {
        description: 'every 10 minutes (144 runs/day)',
        estimatedCallsPerMonth: oldCadenceMonthlyEstimate,
      },
      newCadence: {
        description: 'weekly (about 5 runs/month)',
        estimatedCallsPerMonth: newCadenceMonthlyEstimate,
      },
    },
    note: 'Usage tracking begins from deployment of this instrumentation and is not retroactive.',
  });
};
