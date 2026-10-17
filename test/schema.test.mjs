import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMissionControl, validateSection, validateMetric, validateAlerts } from '../src/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'mission-control.valid.json'), 'utf8'));

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// AC-1
test('validateMissionControl returns valid:true for the valid fixture', () => {
  const result = validateMissionControl(fixture);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateMissionControl returns valid:false with dotted-path errors for invalid input', () => {
  const doc = clone(fixture);
  doc.github.totals.openPRs.source = '';
  const result = validateMissionControl(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  for (const e of result.errors) {
    assert.match(e, /^[a-zA-Z]/);
  }
  assert.ok(result.errors.some((e) => e.startsWith('github.totals.openPRs.source:')));
});

// AC-2 cases, each its own test
test('AC-2: Metric missing source fails', () => {
  const doc = clone(fixture);
  delete doc.github.totals.openPRs.source;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: Metric missing asOf fails', () => {
  const doc = clone(fixture);
  delete doc.github.totals.openPRs.asOf;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: asOf not matching ISO-8601 UTC fails', () => {
  const doc = clone(fixture);
  doc.github.totals.openPRs.asOf = '2026-09-20 06:00:00';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: status UNAVAILABLE with non-null value fails', () => {
  const doc = clone(fixture);
  doc.github.totals.commits7d.value = 5;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: status UNAVAILABLE with null reason fails', () => {
  const doc = clone(fixture);
  doc.github.totals.commits7d.reason = null;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: status UNAVAILABLE with empty reason fails', () => {
  const doc = clone(fixture);
  doc.github.totals.commits7d.reason = '';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: status OK with non-integer value fails', () => {
  const doc = clone(fixture);
  doc.github.totals.openPRs.value = 5.5;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: status OK with negative value fails', () => {
  const doc = clone(fixture);
  doc.github.totals.openPRs.value = -1;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: schemaVersion !== 1 fails', () => {
  const doc = clone(fixture);
  doc.schemaVersion = 2;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: advisor OK with recommendation count other than 3 fails', () => {
  const doc = clone(fixture);
  doc.advisor.recommendations.pop();
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: ranks not exactly [1,2,3] in order fails', () => {
  const doc = clone(fixture);
  doc.advisor.recommendations[0].rank = 2;
  doc.advisor.recommendations[1].rank = 1;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: category priority violated fails', () => {
  const doc = clone(fixture);
  doc.advisor.recommendations[0].category = 'degrading';
  doc.advisor.recommendations[1].category = 'blocker';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: routine action text wrong fails', () => {
  const doc = clone(fixture);
  doc.advisor.recommendations = [
    { rank: 1, category: 'routine', action: 'Nothing to see here', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 2, category: 'unavailable', action: 'UNAVAILABLE', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 3, category: 'unavailable', action: 'UNAVAILABLE', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
  ];
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: more than one routine fails', () => {
  const doc = clone(fixture);
  doc.advisor.recommendations = [
    { rank: 1, category: 'routine', action: 'Routine day — no priority change', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 2, category: 'routine', action: 'Routine day — no priority change', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 3, category: 'unavailable', action: 'UNAVAILABLE', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
  ];
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: routine alongside blocker/outperforming/degrading fails', () => {
  const doc = clone(fixture);
  // rank 1 and 2 stay blocker/outperforming (evidence-backed); rank 3 becomes routine.
  doc.advisor.recommendations[2] = { rank: 3, category: 'routine', action: 'Routine day — no priority change', evidence: 'x', risk: 'y' };
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: section UNAVAILABLE with a total OK fails', () => {
  const doc = clone(fixture);
  doc.supabase.totals.projects = { value: 1, status: 'OK', source: 'x', asOf: '2026-09-20T06:00:00Z', reason: null };
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-2: section UNAVAILABLE with a non-empty list fails', () => {
  const doc = clone(fixture);
  doc.supabase.projects = [{ name: 'x', ref: 'y', status: 'z', securityAdvisors: 1, performanceAdvisors: 1 }];
  assert.equal(validateMissionControl(doc).valid, false);
});

// validateMetric direct
test('validateMetric: valid OK metric has no errors', () => {
  assert.deepEqual(validateMetric({ value: 3, status: 'OK', source: 'gh:x', asOf: '2026-09-20T06:00:00Z', reason: null }, 'm'), []);
});

test('validateMetric: valid UNAVAILABLE metric has no errors', () => {
  assert.deepEqual(validateMetric({ value: null, status: 'UNAVAILABLE', source: 'gh:x', asOf: '2026-09-20T06:00:00Z', reason: 'nope' }, 'm'), []);
});

// validateAlerts
test('validateAlerts: bad metric ref fails', () => {
  const errors = validateAlerts([{ metric: 'bogus', message: 'x', severity: 'warning', source: 's', asOf: '2026-09-20T06:00:00Z' }]);
  assert.ok(errors.length > 0);
});

test('validateAlerts: more than 20 items fails', () => {
  const alerts = Array.from({ length: 21 }, () => ({ metric: 'github.totals.failingCI', message: 'x', severity: 'warning', source: 's', asOf: '2026-09-20T06:00:00Z' }));
  const errors = validateAlerts(alerts);
  assert.ok(errors.length > 0);
});

// AC-29 research section
test('AC-29: research OK requires summary <= 300 chars', () => {
  const doc = clone(fixture);
  doc.research.summary = 'x'.repeat(301);
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-29: research OK requires a valid slug', () => {
  const doc = clone(fixture);
  doc.research.slug = 'Not Valid Slug!';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-29: research OK requires sourceCount >= 3', () => {
  const doc = clone(fixture);
  doc.research.sourceCount = { value: 2, status: 'OK', source: 'axion:researcher', asOf: '2026-09-19T09:00:00Z', reason: null };
  assert.equal(validateMissionControl(doc).valid, false);
});

test('review IMPORTANT #3: research OK with an UNAVAILABLE sourceCount fails', () => {
  const doc = clone(fixture);
  doc.research.sourceCount = { value: null, status: 'UNAVAILABLE', source: 'axion:researcher', asOf: '2026-09-19T09:00:00Z', reason: 'could not count sources' };
  const result = validateMissionControl(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.startsWith('research.sourceCount.status:')));
});

test('AC-29: research UNAVAILABLE with non-null summary fails', () => {
  const doc = clone(fixture);
  doc.research.status = 'UNAVAILABLE';
  doc.research.reason = 'only 1 independent sources';
  // summary stays non-null -> invalid
  assert.equal(validateMissionControl(doc).valid, false);
});

// AC-55 followUps
test('AC-55: followUps with 11 items fails', () => {
  const doc = clone(fixture);
  doc.advisor.followUps = Array.from({ length: 11 }, (_, i) => ({ date: '2026-09-14', action: `a${i}`, ageDays: 3 }));
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-55: followUps ageDays 0 fails', () => {
  const doc = clone(fixture);
  doc.advisor.followUps[0].ageDays = 0;
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-55: followUps bad date fails', () => {
  const doc = clone(fixture);
  doc.advisor.followUps[0].date = '2026-13-40';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-55: followUps must be [] when section UNAVAILABLE', () => {
  const doc = clone(fixture);
  doc.advisor.status = 'UNAVAILABLE';
  doc.advisor.reason = 'inputs missing';
  doc.advisor.recommendations = [];
  // leave followUps non-empty -> invalid
  assert.equal(validateMissionControl(doc).valid, false);
});

// AC-59 alerts shape
test('AC-59: alerts metric must match metricRef pattern', () => {
  const doc = clone(fixture);
  doc.alerts[0].metric = 'orchestrator.totals.steps';
  assert.equal(validateMissionControl(doc).valid, false);
});

test('AC-59: alerts severity must be critical or warning', () => {
  const doc = clone(fixture);
  doc.alerts[0].severity = 'info';
  assert.equal(validateMissionControl(doc).valid, false);
});

// AC-41 orchestrator section rules
test('AC-41: orchestrator UNAVAILABLE requires lastRun null', () => {
  const doc = clone(fixture);
  doc.orchestrator.status = 'UNAVAILABLE';
  doc.orchestrator.reason = 'no runs';
  // lastRun stays non-null -> invalid
  assert.equal(validateMissionControl(doc).valid, false);
});

test('validateSection: unknown section name reports an error', () => {
  const errors = validateSection('bogus', {});
  assert.ok(errors.length > 0);
});
