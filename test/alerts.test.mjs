import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAlerts, toSnapshot, DEFAULT_THRESHOLDS, mergeThresholds } from '../src/lib/alerts.mjs';

function metric(value, status = 'OK', extra = {}) {
  return { value, status, source: 'x', asOf: '2026-09-27T08:00:00Z', reason: status === 'UNAVAILABLE' ? 'n/a' : null, ...extra };
}

function baseDoc(overrides = {}) {
  return {
    generatedAt: '2026-09-27T08:00:00Z',
    github: { totals: { reposTracked: metric(5), commits7d: metric(10), openPRs: metric(1), openIssues: metric(1), failingCI: metric(0) } },
    vercel: { totals: { projects: metric(3), deploys24h: metric(4), failed24h: metric(0) } },
    gmail: { totals: { unread: metric(5), importantUnread: metric(1) } },
    supabase: { totals: { projects: metric(2), securityAdvisors: metric(0), performanceAdvisors: metric(0) } },
    ...overrides,
  };
}

function snapshotWithValue(date, ref, value, status = 'OK') {
  return { date, generatedAt: `${date}T08:00:00Z`, metrics: { [ref]: { value, status } } };
}

test('no history -> threshold alerts only', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, failingCI: metric(2) } } });
  const alerts = computeAlerts(doc, [], DEFAULT_THRESHOLDS);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric, 'github.totals.failingCI');
  assert.equal(alerts[0].severity, 'critical');
  assert.equal(alerts[0].message, 'Failing CI: 2 (threshold >0)');
});

test('critical: vercel failed24h over threshold', () => {
  const doc = baseDoc({ vercel: { totals: { ...baseDoc().vercel.totals, failed24h: metric(3) } } });
  const alerts = computeAlerts(doc, [], DEFAULT_THRESHOLDS);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].message, 'Vercel failed deploys 24h: 3 (threshold >0)');
});

test('+25% change fires a warning', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(125) } } });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  const warn = alerts.find((a) => a.metric === 'github.totals.commits7d');
  assert.ok(warn);
  assert.equal(warn.message, 'github.totals.commits7d changed +25% vs 7-day average 100.0 (1 snapshots)');
});

test('+19% change does not fire', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(119) } } });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  assert.equal(alerts.find((a) => a.metric === 'github.totals.commits7d'), undefined);
});

test('exactly -20% fires a warning (boundary inclusive)', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(80) } } });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  const warn = alerts.find((a) => a.metric === 'github.totals.commits7d');
  assert.ok(warn);
  assert.match(warn.message, /changed -20% /);
});

test('avg 0 -> no percent alert', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(50) } } });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 0)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  assert.equal(alerts.find((a) => a.metric === 'github.totals.commits7d'), undefined);
});

test('current UNAVAILABLE -> no percent alert', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(null, 'UNAVAILABLE') } } });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  assert.equal(alerts.find((a) => a.metric === 'github.totals.commits7d'), undefined);
});

test('snapshot 8 days old is ignored', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(200) } } });
  const history = [snapshotWithValue('2026-09-19', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  assert.equal(alerts.find((a) => a.metric === 'github.totals.commits7d'), undefined);
});

test('an UNAVAILABLE snapshot value is ignored', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, commits7d: metric(200) } } });
  const history = [
    snapshotWithValue('2026-09-24', 'github.totals.commits7d', null, 'UNAVAILABLE'),
    snapshotWithValue('2026-09-25', 'github.totals.commits7d', 100),
  ];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  const warn = alerts.find((a) => a.metric === 'github.totals.commits7d');
  assert.ok(warn);
  assert.match(warn.message, /\(1 snapshots\)/);
});

test('defaults applied when thresholds is undefined', () => {
  const doc = baseDoc({ github: { totals: { ...baseDoc().github.totals, failingCI: metric(1) } } });
  const alerts = computeAlerts(doc, [], undefined);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'critical');
});

test('review IMPORTANT #6: a partial thresholds config still lets the OTHER default-backed rules fire', () => {
  // Only failingCI is overridden; vercelErrors and metricChangePct must
  // still use their defaults instead of becoming `undefined` (which would
  // make every comparison false and silently disable those alerts).
  const doc = baseDoc({
    vercel: { totals: { ...baseDoc().vercel.totals, failed24h: metric(2) } },
    github: { totals: { ...baseDoc().github.totals, openPRs: metric(3) } },
  });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.openPRs', 1)];
  const alerts = computeAlerts(doc, history, { failingCI: 5 });

  const vercelAlert = alerts.find((a) => a.metric === 'vercel.totals.failed24h');
  assert.ok(vercelAlert, 'vercelErrors must still default to 0 and fire');
  assert.equal(vercelAlert.severity, 'critical');

  const percentAlert = alerts.find((a) => a.metric === 'github.totals.openPRs');
  assert.ok(percentAlert, 'metricChangePct must still default to 20 and fire on +200%');
});

// review round 2 MINOR #10: non-finite threshold values (null, a string,
// NaN, Infinity) must never override the numeric defaults, and must never
// produce a message like "threshold >null".
test('mergeThresholds ignores non-finite override values and keeps the default', () => {
  assert.deepEqual(mergeThresholds({ failingCI: null, vercelErrors: null }), DEFAULT_THRESHOLDS);
  assert.deepEqual(mergeThresholds({ failingCI: 'five' }), DEFAULT_THRESHOLDS);
  assert.deepEqual(mergeThresholds({ metricChangePct: NaN }), DEFAULT_THRESHOLDS);
  assert.deepEqual(mergeThresholds({ metricChangePct: Infinity }), DEFAULT_THRESHOLDS);
  assert.deepEqual(mergeThresholds(undefined), DEFAULT_THRESHOLDS);
  assert.deepEqual(mergeThresholds({ failingCI: 5 }), { ...DEFAULT_THRESHOLDS, failingCI: 5 });
});

test('review round 2 MINOR #10: computeAlerts never renders "threshold >null" from a null threshold override', () => {
  const doc = baseDoc({ vercel: { totals: { ...baseDoc().vercel.totals, failed24h: metric(2) } } });
  const alerts = computeAlerts(doc, [], { failingCI: null, vercelErrors: null });
  const vercelAlert = alerts.find((a) => a.metric === 'vercel.totals.failed24h');
  assert.ok(vercelAlert, 'a null override must fall back to the default (0) and still fire');
  assert.equal(vercelAlert.message, 'Vercel failed deploys 24h: 2 (threshold >0)');
  assert.ok(!vercelAlert.message.includes('null'));
});

test('ordering: criticals first, then warnings in section/key order', () => {
  const doc = baseDoc({
    github: { totals: { ...baseDoc().github.totals, failingCI: metric(2), commits7d: metric(200) } },
    vercel: { totals: { ...baseDoc().vercel.totals, failed24h: metric(1) } },
  });
  const history = [snapshotWithValue('2026-09-24', 'github.totals.commits7d', 100)];
  const alerts = computeAlerts(doc, history, DEFAULT_THRESHOLDS);
  assert.equal(alerts[0].metric, 'github.totals.failingCI');
  assert.equal(alerts[1].metric, 'vercel.totals.failed24h');
  assert.equal(alerts[2].metric, 'github.totals.commits7d');
});

test('toSnapshot builds the history snapshot shape', () => {
  const doc = baseDoc();
  const snap = toSnapshot(doc);
  assert.equal(snap.date, '2026-09-27');
  assert.equal(snap.metrics['github.totals.commits7d'].value, 10);
  assert.equal(snap.metrics['github.totals.commits7d'].status, 'OK');
});
