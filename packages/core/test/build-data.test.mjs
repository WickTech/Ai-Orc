import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMissionControl, writeBuildOutputs, computeProgress } from '../src/build-data.mjs';
import { validateMissionControl } from '../src/lib/schema.mjs';

// review MINOR #20: remove every mkdtemp'd root once this file's tests finish.
const createdDirs = [];
after(async () => {
  await Promise.all(createdDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

const CONFIG = {
  github: { owner: 'WickTech', maxRepos: 15, activeWithinDays: 30 },
  thresholds: { metricChangePct: 20, failingCI: 0, vercelErrors: 0 },
  objective: {
    title: 'KEEP THE FLEET GREEN',
    targets: [
      { id: 'ci', label: 'FAILING CI', metricRef: 'github.totals.failingCI', comparator: 'atMost', target: 0 },
      { id: 'deploys', label: 'FAILED DEPLOYS 24H', metricRef: 'vercel.totals.failed24h', comparator: 'atMost', target: 0 },
      { id: 'inbox', label: 'IMPORTANT UNREAD', metricRef: 'gmail.totals.importantUnread', comparator: 'atMost', target: 5 },
      { id: 'db', label: 'SUPABASE SECURITY ADVISORS', metricRef: 'supabase.totals.securityAdvisors', comparator: 'atMost', target: 0 },
      { id: 'bogus', label: 'BOGUS', metricRef: 'github.totals.notARealKey', comparator: 'atMost', target: 0 },
    ],
  },
};

async function makeRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axion-build-'));
  createdDirs.push(dir);
  await fs.mkdir(path.join(dir, 'config'), { recursive: true });
  await fs.mkdir(path.join(dir, 'data', 'sources'), { recursive: true });
  await fs.writeFile(path.join(dir, 'config', 'axion.config.json'), JSON.stringify(CONFIG));
  return dir;
}

function metric(value, status = 'OK') {
  return { value, status, source: 'test', asOf: '2026-09-27T08:00:00Z', reason: status === 'UNAVAILABLE' ? 'n/a' : null };
}

async function writeSection(rootDir, name, obj) {
  await fs.writeFile(path.join(rootDir, 'data', 'sources', `${name}.json`), JSON.stringify(obj));
}

const OK_GITHUB = {
  status: 'OK', source: 'gh:WickTech', asOf: '2026-09-27T08:00:00Z', reason: null,
  totals: { reposTracked: metric(1), commits7d: metric(1), openPRs: metric(1), openIssues: metric(1), failingCI: metric(1) },
  repos: [],
};
const OK_VERCEL = {
  status: 'OK', source: 'vercel:x', asOf: '2026-09-27T08:00:00Z', reason: null,
  totals: { projects: metric(1), deploys24h: metric(1), failed24h: metric(1) },
  projects: [],
};
const OK_GMAIL = {
  status: 'OK', source: 'gmail:x', asOf: '2026-09-27T08:00:00Z', reason: null,
  totals: { unread: metric(1), importantUnread: metric(1) },
  topThreads: [],
};
const OK_SUPABASE = {
  status: 'OK', source: 'supabase:x', asOf: '2026-09-27T08:00:00Z', reason: null,
  totals: { projects: metric(1), securityAdvisors: metric(1), performanceAdvisors: metric(1) },
  projects: [],
};
const OK_ADVISOR = {
  status: 'OK', source: 'axion:advisor', asOf: '2026-09-27T08:00:00Z', reason: null,
  recommendations: [
    { rank: 1, category: 'routine', action: 'Routine day — no priority change', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 2, category: 'unavailable', action: 'UNAVAILABLE', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
    { rank: 3, category: 'unavailable', action: 'UNAVAILABLE', evidence: 'UNAVAILABLE', risk: 'UNAVAILABLE' },
  ],
  followUps: [],
};
const OK_RESEARCH = {
  status: 'OK', source: 'axion:researcher', asOf: '2026-09-27T08:00:00Z', reason: null,
  topic: 't', slug: 'slug', generatedAt: '2026-09-27T08:00:00Z', summary: 's', sourceCount: metric(3),
};
const OK_ORCH = {
  status: 'OK', source: 'orchestrator:data/orchestrator-log.md', asOf: '2026-09-27T08:00:00Z', reason: null,
  lastRun: null,
  totals: { steps: metric(0), auto: metric(0), approved: metric(0), denied: metric(0), skipped: metric(0), failed: metric(0) },
};

async function writeAllOkSections(rootDir) {
  await writeSection(rootDir, 'github', OK_GITHUB);
  await writeSection(rootDir, 'vercel', OK_VERCEL);
  await writeSection(rootDir, 'gmail', OK_GMAIL);
  await writeSection(rootDir, 'supabase', OK_SUPABASE);
  await writeSection(rootDir, 'advisor', OK_ADVISOR);
  await writeSection(rootDir, 'research', OK_RESEARCH);
  await writeSection(rootDir, 'orchestrator', OK_ORCH);
}

test('AC-9: missing source file becomes UNAVAILABLE with the right reason', async () => {
  const rootDir = await makeRoot();
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc } = await buildMissionControl({ rootDir, now });
  assert.equal(doc.github.status, 'UNAVAILABLE');
  assert.equal(doc.github.reason, 'source file missing: data/sources/github.json');
  assert.equal(doc.github.source, 'axion:build-data');
});

test('AC-9: invalid JSON becomes UNAVAILABLE naming the file', async () => {
  const rootDir = await makeRoot();
  await fs.writeFile(path.join(rootDir, 'data', 'sources', 'github.json'), '{ not json');
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc } = await buildMissionControl({ rootDir, now });
  assert.equal(doc.github.status, 'UNAVAILABLE');
  assert.match(doc.github.reason, /data\/sources\/github\.json/);
});

test('AC-9: a section failing validateSection becomes UNAVAILABLE naming the first error', async () => {
  const rootDir = await makeRoot();
  await writeSection(rootDir, 'github', { ...OK_GITHUB, totals: { ...OK_GITHUB.totals, openPRs: { value: -1, status: 'OK', source: 'x', asOf: '2026-09-27T08:00:00Z', reason: null } } });
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc } = await buildMissionControl({ rootDir, now });
  assert.equal(doc.github.status, 'UNAVAILABLE');
  assert.match(doc.github.reason, /data\/sources\/github\.json/);
});

test('AC-9/AC-10: with all sections OK, doc validates and objective progress resolves; unknown metricRef -> UNAVAILABLE', async () => {
  const rootDir = await makeRoot();
  await writeAllOkSections(rootDir);
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc, errors } = await buildMissionControl({ rootDir, now });
  assert.deepEqual(errors, []);
  assert.equal(doc.dataMode, 'live');
  assert.equal(doc.generatedAt, now.toISOString());

  const bogusTarget = doc.objective.targets.find((t) => t.id === 'bogus');
  assert.equal(bogusTarget.current.status, 'UNAVAILABLE');
  assert.equal(bogusTarget.current.reason, 'unknown metricRef: github.totals.notARealKey');
  assert.equal(bogusTarget.progress, null);

  const ciTarget = doc.objective.targets.find((t) => t.id === 'ci');
  assert.equal(ciTarget.current.value, 1);
});

test('computeProgress: atLeast/atMost table', () => {
  assert.equal(computeProgress('atLeast', 0, { status: 'OK', value: 5 }), 1);
  assert.equal(computeProgress('atLeast', 10, { status: 'OK', value: 5 }), 0.5);
  assert.equal(computeProgress('atLeast', 10, { status: 'OK', value: 20 }), 1);
  assert.equal(computeProgress('atMost', 5, { status: 'OK', value: 5 }), 1);
  assert.equal(computeProgress('atMost', 0, { status: 'OK', value: 4 }), 0);
  assert.equal(computeProgress('atMost', 5, { status: 'OK', value: 10 }), 0.5);
  assert.equal(computeProgress('atMost', 5, { status: 'UNAVAILABLE', value: null }), null);
});

test('AC-11/AC-57: writeBuildOutputs writes mission-control.json and a history snapshot', async () => {
  const rootDir = await makeRoot();
  await writeAllOkSections(rootDir);
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc, errors } = await buildMissionControl({ rootDir, now });
  assert.deepEqual(errors, []);
  await writeBuildOutputs({ rootDir, doc, now });

  const written = JSON.parse(await fs.readFile(path.join(rootDir, 'data', 'mission-control.json'), 'utf8'));
  assert.equal(validateMissionControl(written).valid, true);

  const snap = JSON.parse(await fs.readFile(path.join(rootDir, 'data', 'history', '2026-09-27.json'), 'utf8'));
  assert.equal(snap.date, '2026-09-27');
  assert.equal(snap.metrics['github.totals.openPRs'].value, 1);
});

test('review IMPORTANT #6: a partial thresholds config still applies the other defaults', async () => {
  const rootDir = await makeRoot();
  await fs.writeFile(path.join(rootDir, 'config', 'axion.config.json'), JSON.stringify({ ...CONFIG, thresholds: { failingCI: 5 } }));
  await writeAllOkSections(rootDir);
  await writeSection(rootDir, 'vercel', { ...OK_VERCEL, totals: { ...OK_VERCEL.totals, failed24h: metric(2) } });
  const now = new Date('2026-09-27T08:00:00Z');
  const { doc } = await buildMissionControl({ rootDir, now });
  const vercelAlert = doc.alerts.find((a) => a.metric === 'vercel.totals.failed24h');
  assert.ok(vercelAlert, 'vercelErrors must still default to 0 even though only failingCI was set');
  assert.equal(vercelAlert.severity, 'critical');
});

test('AC-11: an invalid merged document is never written; existing files stay untouched', async () => {
  const rootDir = await makeRoot();
  // An empty objective title makes the merged document fail validation,
  // with no section itself being invalid.
  await fs.writeFile(path.join(rootDir, 'config', 'axion.config.json'), JSON.stringify({ ...CONFIG, objective: { ...CONFIG.objective, title: '' } }));
  await writeAllOkSections(rootDir);

  const existingPath = path.join(rootDir, 'data', 'mission-control.json');
  const sentinel = '{"sentinel":true}';
  await fs.writeFile(existingPath, sentinel);

  const now = new Date('2026-09-27T08:00:00Z');
  const { doc, errors } = await buildMissionControl({ rootDir, now });
  assert.ok(errors.length > 0);

  // The caller (scripts/build-data.mjs) must not call writeBuildOutputs
  // when errors is non-empty; simulate that contract directly here and
  // confirm the existing file is exactly as it was.
  const after = await fs.readFile(existingPath, 'utf8');
  assert.equal(after, sentinel);
  assert.ok(doc); // the merged doc is still returned for error reporting
});

test('AC-11: scripts/build-data.mjs exits 1 and leaves an existing mission-control.json untouched on an invalid merge', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const rootDir = await makeRoot();
  await fs.writeFile(path.join(rootDir, 'config', 'axion.config.json'), JSON.stringify({ ...CONFIG, objective: { ...CONFIG.objective, title: '' } }));
  await writeAllOkSections(rootDir);
  const existingPath = path.join(rootDir, 'data', 'mission-control.json');
  const sentinel = '{"sentinel":true}';
  await fs.writeFile(existingPath, sentinel);

  await assert.rejects(
    execFileAsync(process.execPath, [path.join(process.cwd(), 'scripts', 'build-data.mjs')], { cwd: rootDir }),
    (err) => {
      assert.equal(err.code, 1);
      return true;
    },
  );
  const after = await fs.readFile(existingPath, 'utf8');
  assert.equal(after, sentinel);
});

test('AC-57: history pruning keeps only the newest 30 dated files, leaves other files alone', async () => {
  const rootDir = await makeRoot();
  await writeAllOkSections(rootDir);
  const historyDir = path.join(rootDir, 'data', 'history');
  await fs.mkdir(historyDir, { recursive: true });
  for (let i = 1; i <= 32; i += 1) {
    const day = String(i).padStart(2, '0');
    await fs.writeFile(path.join(historyDir, `2026-01-${day}.json`), JSON.stringify({ date: `2026-01-${day}`, generatedAt: 'x', metrics: {} }));
  }
  await fs.writeFile(path.join(historyDir, 'notes.txt'), 'keep me');

  const now = new Date('2026-09-27T08:00:00Z');
  const { doc } = await buildMissionControl({ rootDir, now });
  await writeBuildOutputs({ rootDir, doc, now });

  const files = await fs.readdir(historyDir);
  const jsonFiles = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.equal(jsonFiles.length, 30);
  assert.ok(files.includes('notes.txt'));
});
