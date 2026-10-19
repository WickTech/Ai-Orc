// GitHub collector (A2, AC-4 to AC-8).

import { execFile } from 'node:child_process';
import { ok, unavailable, unavailableSection } from '../lib/metric.mjs';

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const DAY_MS = 86400000;
const REPO_LIST_LIMIT = 200;

function asOfNow(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Parses gh's JSON output and requires it to be an array. A non-array reply
 * (e.g. `null`, an error object) must never be silently coerced into an
 * undercount (review MINOR #19) — callers treat a thrown error the same way
 * as a failed call.
 * @param {string} text
 * @returns {unknown[]}
 */
function parseJsonArray(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('expected a JSON array');
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
export function defaultRunGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * @param {{runGh: (args:string[]) => Promise<string>, now: Date, config: object}} deps
 */
export async function collectGithub({ runGh, now, config }) {
  const owner = config.github.owner;
  const maxRepos = config.github.maxRepos;
  const activeWithinDays = config.github.activeWithinDays;
  const source = `gh:${owner}`;
  const asOf = asOfNow(now);

  let rawRepos;
  try {
    const stdout = await runGh([
      'repo', 'list', owner,
      '--limit', String(REPO_LIST_LIMIT),
      '--json', 'name,url,pushedAt,isArchived,defaultBranchRef',
    ]);
    rawRepos = parseJsonArray(stdout);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return unavailableSection('github', 'gh CLI not found', source, asOf);
    }
    const stderrText = String((err && err.stderr) || (err && err.message) || '');
    const firstLine = stderrText.split('\n')[0].trim().slice(0, 200);
    return unavailableSection('github', firstLine || 'gh repo list failed', source, asOf);
  }

  // The repo list itself is fetched with the same `--limit`, so it can be
  // truncated exactly like a per-repo PR/issue list (AC-7's spirit).
  const repoListTruncated = rawRepos.length === REPO_LIST_LIMIT;

  const activeCutoff = now.getTime() - activeWithinDays * DAY_MS;
  const active = rawRepos
    .filter((r) => !r.isArchived)
    .filter((r) => r.pushedAt && new Date(r.pushedAt).getTime() >= activeCutoff)
    .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
    .slice(0, maxRepos);

  const sinceIso = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const repos = [];
  const failedRepos = { commits7d: [], openPRs: [], openIssues: [], ci: [] };

  for (const r of active) {
    const repoName = r.name;
    const def = r.defaultBranchRef && r.defaultBranchRef.name;
    const repoSlug = `${owner}/${repoName}`;

    let openPRs = null;
    try {
      const stdout = await runGh(['pr', 'list', '--repo', repoSlug, '--state', 'open', '--limit', '200', '--json', 'number']);
      const arr = parseJsonArray(stdout);
      openPRs = arr.length === 200 ? null : arr.length;
      if (openPRs === null) failedRepos.openPRs.push(repoName);
    } catch {
      openPRs = null;
      failedRepos.openPRs.push(repoName);
    }

    let openIssues = null;
    try {
      const stdout = await runGh(['issue', 'list', '--repo', repoSlug, '--state', 'open', '--limit', '200', '--json', 'number']);
      const arr = parseJsonArray(stdout);
      openIssues = arr.length === 200 ? null : arr.length;
      if (openIssues === null) failedRepos.openIssues.push(repoName);
    } catch {
      openIssues = null;
      failedRepos.openIssues.push(repoName);
    }

    let ci = 'UNAVAILABLE';
    try {
      const runArgs = ['run', 'list', '--repo', repoSlug];
      if (def) runArgs.push('--branch', def);
      runArgs.push('--limit', '1', '--json', 'status,conclusion');
      const stdout = await runGh(runArgs);
      const arr = parseJsonArray(stdout);
      if (arr.length === 0) {
        ci = 'none';
      } else {
        const run = arr[0];
        if (run.status !== 'completed') ci = 'in_progress';
        else if (run.conclusion === 'success') ci = 'success';
        else if (FAILURE_CONCLUSIONS.has(run.conclusion)) ci = 'failure';
        else ci = 'other';
      }
    } catch {
      ci = 'UNAVAILABLE';
      failedRepos.ci.push(repoName);
    }

    let commits7d = null;
    try {
      const stdout = await runGh([
        'api', '--paginate',
        `repos/${repoSlug}/commits?since=${sinceIso}&per_page=100`,
        '--jq', 'length',
      ]);
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      commits7d = lines.reduce((sum, l) => sum + Number(l), 0);
    } catch (err) {
      const stderrText = String((err && err.stderr) || '');
      if (stderrText.includes('Git Repository is empty')) {
        commits7d = 0;
      } else {
        commits7d = null;
        failedRepos.commits7d.push(repoName);
      }
    }

    repos.push({
      name: repoName,
      url: r.url,
      lastPushAt: r.pushedAt,
      commits7d,
      openPRs,
      openIssues,
      ci,
    });
  }

  function sumOrUnavailable(key, failedList) {
    if (failedList.length > 0) {
      return unavailable(`partial data: ${failedList.join(', ')} failed`, source, asOf);
    }
    const sum = repos.reduce((acc, r) => acc + (r[key] || 0), 0);
    return ok(sum, source, asOf);
  }

  const totals = {
    reposTracked: repoListTruncated
      ? unavailable(`repo list returned exactly ${REPO_LIST_LIMIT} entries (possibly truncated)`, source, asOf)
      : ok(active.length, source, asOf),
    commits7d: sumOrUnavailable('commits7d', failedRepos.commits7d),
    openPRs: sumOrUnavailable('openPRs', failedRepos.openPRs),
    openIssues: sumOrUnavailable('openIssues', failedRepos.openIssues),
    failingCI:
      failedRepos.ci.length > 0
        ? unavailable(`partial data: ${failedRepos.ci.join(', ')} failed`, source, asOf)
        : ok(repos.filter((r) => r.ci === 'failure').length, source, asOf),
  };

  return { status: 'OK', source, asOf, reason: null, totals, repos };
}
