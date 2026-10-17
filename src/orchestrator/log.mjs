// Orchestrator run log + orchestrator section builder (AC-40, AC-41).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ok } from '../lib/metric.mjs';

function sanitizeTask(task) {
  return String(task).replace(/\r?\n/g, ' ').replace(/\|/g, '/').slice(0, 200);
}

function fmtExit(exitCode) {
  if (exitCode === null || exitCode === undefined) return '-';
  return String(exitCode);
}

function fmtDuration(durationMs) {
  if (durationMs === null || durationMs === undefined) return '-';
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * @param {{task:string, startedAt:string, results:object[]}} args
 * @returns {string}
 */
export function formatRunLog({ task, startedAt, results }) {
  const lines = [];
  lines.push(`## Orchestrator run ${startedAt} — ${sanitizeTask(task)}`);
  lines.push('');
  for (const r of results) {
    lines.push(`${r.n} | ${r.agent} | ${r.risk} | ${r.decision} | ${fmtExit(r.exitCode)} | ${fmtDuration(r.durationMs)} | ${r.note || '-'}`);
  }
  lines.push('');
  lines.push('### Output');
  for (const r of results) {
    if (r.decision !== 'AUTO' && r.decision !== 'APPROVED') continue;
    lines.push('');
    lines.push(`#### Step ${r.n} — ${r.agent}`);
    lines.push('```text');
    lines.push((r.stdout || '').slice(-2000));
    lines.push('```');
    lines.push('```text');
    lines.push((r.stderr || '').slice(-2000));
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {string} rootDir
 * @param {string} text
 */
export async function appendRunLog(rootDir, text) {
  const p = path.join(rootDir, 'data', 'orchestrator-log.md');
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, `${text}\n`, 'utf8');
}

/**
 * @param {{task:string, startedAt:string, results:object[], outcome:string, asOf:string}} args
 */
export function toOrchestratorSection({ task, startedAt, results, outcome, asOf }) {
  const source = 'orchestrator:data/orchestrator-log.md';
  const auto = results.filter((r) => r.decision === 'AUTO').length;
  const approved = results.filter((r) => r.decision === 'APPROVED').length;
  const denied = results.filter((r) => r.decision === 'DENIED').length;
  const skipped = results.filter((r) => r.decision === 'SKIPPED').length;
  const failed = results.filter((r) => (r.decision === 'AUTO' || r.decision === 'APPROVED') && r.exitCode !== 0).length;

  return {
    status: 'OK',
    source,
    asOf,
    reason: null,
    lastRun: { task, startedAt, outcome },
    totals: {
      steps: ok(results.length, source, asOf),
      auto: ok(auto, source, asOf),
      approved: ok(approved, source, asOf),
      denied: ok(denied, source, asOf),
      skipped: ok(skipped, source, asOf),
      failed: ok(failed, source, asOf),
    },
  };
}
