// Merge step (A2, AC-9 to AC-11, AC-57).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateMissionControl, validateSection } from './lib/schema.mjs';
import { unavailableSection } from './lib/metric.mjs';
import { computeAlerts, toSnapshot, mergeThresholds } from './lib/alerts.mjs';

const SECTION_NAMES = ['github', 'vercel', 'gmail', 'supabase', 'advisor', 'research', 'orchestrator'];
const HISTORY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

/**
 * @param {string} p
 * @param {string} text
 */
export async function writeAtomic(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${randomBytes(6).toString('hex')}`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, p);
}

/**
 * @param {'atMost'|'atLeast'} comparator
 * @param {number} target
 * @param {{status:string, value:number|null}} metric
 * @returns {number|null}
 */
export function computeProgress(comparator, target, metric) {
  if (!metric || metric.status === 'UNAVAILABLE') return null;
  const current = metric.value;
  if (comparator === 'atLeast') {
    return target <= 0 ? 1 : Math.min(current / target, 1);
  }
  // atMost
  return current <= target ? 1 : target / current;
}

async function readJson(p) {
  const text = await fs.readFile(p, 'utf8');
  return JSON.parse(text);
}

async function loadSection(rootDir, name, asOf) {
  const relPath = `data/sources/${name}.json`;
  const fullPath = path.join(rootDir, relPath);
  let text;
  try {
    text = await fs.readFile(fullPath, 'utf8');
  } catch {
    return unavailableSection(name, `source file missing: ${relPath}`, 'axion:build-data', asOf);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    return unavailableSection(name, `${relPath}: invalid JSON (${err.message})`, 'axion:build-data', asOf);
  }
  const errors = validateSection(name, obj);
  if (errors.length > 0) {
    return unavailableSection(name, `${relPath}: ${errors[0]}`, 'axion:build-data', asOf);
  }
  return obj;
}

async function loadHistory(rootDir) {
  const dir = path.join(rootDir, 'data', 'history');
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const snapshots = [];
  for (const file of files) {
    if (!HISTORY_FILE_RE.test(file)) continue;
    try {
      const snap = await readJson(path.join(dir, file));
      snapshots.push(snap);
    } catch {
      // malformed history files are ignored
    }
  }
  return snapshots;
}

async function readConfig(rootDir) {
  return readJson(path.join(rootDir, 'config', 'axion.config.json'));
}

function resolveMetricRef(doc, ref) {
  const match = /^(github|vercel|gmail|supabase)\.totals\.([A-Za-z0-9]+)$/.exec(ref);
  if (!match) return null;
  const [, section, key] = match;
  const metric = doc[section] && doc[section].totals && doc[section].totals[key];
  return metric || null;
}

/**
 * @param {{rootDir:string, now:Date}} args
 * @returns {Promise<{doc:object, errors:string[]}>}
 */
export async function buildMissionControl({ rootDir, now }) {
  const generatedAt = now.toISOString();
  const config = await readConfig(rootDir);

  const doc = {
    schemaVersion: 1,
    generatedAt,
    dataMode: 'live',
    alerts: [],
    objective: { title: config.objective.title, targets: [] },
  };

  for (const name of SECTION_NAMES) {
    doc[name] = await loadSection(rootDir, name, generatedAt);
  }

  doc.objective.targets = (config.objective.targets || []).map((t) => {
    const metric = resolveMetricRef(doc, t.metricRef);
    if (!metric) {
      const current = {
        value: null,
        status: 'UNAVAILABLE',
        source: 'axion:build-data',
        asOf: generatedAt,
        reason: `unknown metricRef: ${t.metricRef}`,
      };
      return {
        id: t.id,
        label: t.label,
        metricRef: t.metricRef,
        comparator: t.comparator,
        target: t.target,
        current,
        progress: null,
      };
    }
    const current = { ...metric };
    const progress = computeProgress(t.comparator, t.target, current);
    return { id: t.id, label: t.label, metricRef: t.metricRef, comparator: t.comparator, target: t.target, current, progress };
  });

  // Merge per key with the defaults, ignoring non-finite values (review
  // IMPORTANT #6 and round 2 MINOR #10) — computeAlerts does the same
  // merge itself, but doing it here too keeps this call site honest about
  // what it is passing.
  const thresholds = mergeThresholds(config.thresholds);
  const history = await loadHistory(rootDir);
  doc.alerts = computeAlerts(doc, history, thresholds);

  const { errors } = validateMissionControl(doc);
  return { doc, errors };
}

/**
 * @param {{rootDir:string, doc:object, now:Date}} args
 */
export async function writeBuildOutputs({ rootDir, doc, now }) {
  const missionControlPath = path.join(rootDir, 'data', 'mission-control.json');
  await writeAtomic(missionControlPath, `${JSON.stringify(doc, null, 2)}\n`);

  const snapshot = toSnapshot(doc);
  const historyDir = path.join(rootDir, 'data', 'history');
  const historyPath = path.join(historyDir, `${snapshot.date}.json`);
  await writeAtomic(historyPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  let files;
  try {
    files = await fs.readdir(historyDir);
  } catch {
    files = [];
  }
  const jsonFiles = files.filter((f) => HISTORY_FILE_RE.test(f)).sort();
  const excess = jsonFiles.length - 30;
  if (excess > 0) {
    const toDelete = jsonFiles.slice(0, excess);
    for (const file of toDelete) {
      await fs.unlink(path.join(historyDir, file));
    }
  }
}
