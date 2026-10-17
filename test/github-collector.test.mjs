import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGithub } from '../src/collectors/github.mjs';
import { validateSection } from '../src/lib/schema.mjs';

const NOW = new Date('2026-09-27T08:00:00.000Z');
const CONFIG = { github: { owner: 'WickTech', maxRepos: 15, activeWithinDays: 30 } };

function key(args) {
  return args.join(' ');
}

test('AC-4: collectGithub returns a section that passes validateSection, with totals as sums', async () => {
  const repoListArgs = key(['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']);
  const responses = new Map();
  responses.set(repoListArgs, JSON.stringify([
    { name: 'active-1', url: 'https://github.com/WickTech/active-1', pushedAt: '2026-09-26T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
    { name: 'active-2', url: 'https://github.com/WickTech/active-2', pushedAt: '2026-09-20T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
    { name: 'archived-1', url: 'https://github.com/WickTech/archived-1', pushedAt: '2026-09-26T00:00:00Z', isArchived: true, defaultBranchRef: { name: 'main' } },
    { name: 'stale-1', url: 'https://github.com/WickTech/stale-1', pushedAt: '2026-01-01T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
  ]));

  function setRepoCalls(name, { prs, issues, run, commitsLines }) {
    responses.set(key(['pr', 'list', '--repo', `WickTech/${name}`, '--state', 'open', '--limit', '200', '--json', 'number']), JSON.stringify(prs));
    responses.set(key(['issue', 'list', '--repo', `WickTech/${name}`, '--state', 'open', '--limit', '200', '--json', 'number']), JSON.stringify(issues));
    responses.set(key(['run', 'list', '--repo', `WickTech/${name}`, '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']), JSON.stringify(run));
    responses.set(key(['api', '--paginate', `repos/WickTech/${name}/commits?since=2026-09-20T08:00:00.000Z&per_page=100`, '--jq', 'length']), commitsLines.join('\n'));
  }

  setRepoCalls('active-1', { prs: [{ number: 1 }, { number: 2 }], issues: [{ number: 1 }], run: [{ status: 'completed', conclusion: 'failure' }], commitsLines: ['100'] });
  setRepoCalls('active-2', { prs: [{ number: 3 }], issues: [{ number: 2 }, { number: 3 }], run: [{ status: 'completed', conclusion: 'success' }], commitsLines: ['50'] });

  const runGh = async (args) => {
    const k = key(args);
    if (!responses.has(k)) throw new Error(`unexpected gh call: ${k}`);
    return responses.get(k);
  };

  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  const errors = validateSection('github', section);
  assert.deepEqual(errors, []);

  assert.equal(section.repos.length, 2, 'drops archived and stale repos, keeps active ones');
  assert.equal(section.repos[0].name, 'active-1', 'most recently pushed first');
  assert.equal(section.totals.reposTracked.value, 2);
  assert.equal(section.totals.commits7d.value, 150);
  assert.equal(section.totals.openPRs.value, 3);
  assert.equal(section.totals.openIssues.value, 3);
  assert.equal(section.totals.failingCI.value, 1);
});

test('AC-4: keeps at most maxRepos, most recently pushed first', async () => {
  const config = { github: { owner: 'WickTech', maxRepos: 1, activeWithinDays: 30 } };
  const responses = new Map();
  responses.set(key(['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']), JSON.stringify([
    { name: 'older', url: 'u1', pushedAt: '2026-09-20T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
    { name: 'newer', url: 'u2', pushedAt: '2026-09-26T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
  ]));
  responses.set(key(['pr', 'list', '--repo', 'WickTech/newer', '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
  responses.set(key(['issue', 'list', '--repo', 'WickTech/newer', '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
  responses.set(key(['run', 'list', '--repo', 'WickTech/newer', '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']), '[]');
  responses.set(key(['api', '--paginate', 'repos/WickTech/newer/commits?since=2026-09-20T08:00:00.000Z&per_page=100', '--jq', 'length']), '0');

  const runGh = async (args) => {
    const k = key(args);
    if (!responses.has(k)) throw new Error(`unexpected gh call: ${k}`);
    return responses.get(k);
  };
  const section = await collectGithub({ runGh, now: NOW, config });
  assert.equal(section.repos.length, 1);
  assert.equal(section.repos[0].name, 'newer');
});

test('AC-4: asserts the exact args of the repo list call', async () => {
  let capturedArgs = null;
  const runGh = async (args) => {
    if (capturedArgs === null) capturedArgs = args;
    return '[]';
  };
  await collectGithub({ runGh, now: NOW, config: CONFIG });
  assert.deepEqual(capturedArgs, ['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']);
});

test('AC-5: gh missing (ENOENT) yields UNAVAILABLE section, never throws', async () => {
  const runGh = async () => {
    const err = new Error('spawn gh ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  assert.equal(section.status, 'UNAVAILABLE');
  assert.equal(section.reason, 'gh CLI not found');
  assert.deepEqual(section.repos, []);
  for (const m of Object.values(section.totals)) {
    assert.equal(m.status, 'UNAVAILABLE');
  }
});

test('AC-5: gh repo list non-zero exit yields UNAVAILABLE with trimmed stderr reason', async () => {
  const longLine = 'x'.repeat(300);
  const runGh = async () => {
    const err = new Error('exit 1');
    err.stderr = `${longLine}\nsecond line`;
    throw err;
  };
  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  assert.equal(section.status, 'UNAVAILABLE');
  assert.equal(section.reason.length, 200);
  assert.equal(section.reason, longLine.slice(0, 200));
});

test('AC-6: a failed repo call yields null field + UNAVAILABLE total with reason, other totals stay OK', async () => {
  const responses = new Map();
  responses.set(key(['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']), JSON.stringify([
    { name: 'ok-repo', url: 'u1', pushedAt: '2026-09-26T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
    { name: 'bad-repo', url: 'u2', pushedAt: '2026-09-25T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
  ]));
  for (const name of ['ok-repo', 'bad-repo']) {
    responses.set(key(['pr', 'list', '--repo', `WickTech/${name}`, '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
    responses.set(key(['issue', 'list', '--repo', `WickTech/${name}`, '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
    responses.set(key(['run', 'list', '--repo', `WickTech/${name}`, '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']), '[]');
  }
  responses.set(key(['api', '--paginate', 'repos/WickTech/ok-repo/commits?since=2026-09-20T08:00:00.000Z&per_page=100', '--jq', 'length']), '5');

  const runGh = async (args) => {
    const k = key(args);
    if (k === key(['api', '--paginate', 'repos/WickTech/bad-repo/commits?since=2026-09-20T08:00:00.000Z&per_page=100', '--jq', 'length'])) {
      throw new Error('boom');
    }
    if (!responses.has(k)) throw new Error(`unexpected gh call: ${k}`);
    return responses.get(k);
  };

  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  const badRepo = section.repos.find((r) => r.name === 'bad-repo');
  assert.equal(badRepo.commits7d, null);
  assert.equal(section.totals.commits7d.status, 'UNAVAILABLE');
  assert.match(section.totals.commits7d.reason, /partial data: bad-repo failed/);
  assert.equal(section.totals.openPRs.status, 'OK');
  assert.equal(section.totals.openIssues.status, 'OK');
});

test('AC-6: an empty repo (Git Repository is empty) counts as 0 commits, not a failure', async () => {
  const responses = new Map();
  responses.set(key(['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']), JSON.stringify([
    { name: 'empty-repo', url: 'u1', pushedAt: '2026-09-26T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
  ]));
  responses.set(key(['pr', 'list', '--repo', 'WickTech/empty-repo', '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
  responses.set(key(['issue', 'list', '--repo', 'WickTech/empty-repo', '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
  responses.set(key(['run', 'list', '--repo', 'WickTech/empty-repo', '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']), '[]');

  const runGh = async (args) => {
    const k = key(args);
    if (k === key(['api', '--paginate', 'repos/WickTech/empty-repo/commits?since=2026-09-20T08:00:00.000Z&per_page=100', '--jq', 'length'])) {
      const err = new Error('exit 1');
      err.stderr = 'error: Git Repository is empty.';
      throw err;
    }
    if (!responses.has(k)) throw new Error(`unexpected gh call: ${k}`);
    return responses.get(k);
  };

  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  assert.equal(section.repos[0].commits7d, 0);
  assert.equal(section.totals.commits7d.status, 'OK');
});

test('AC-7: PR list returning exactly the limit (200) makes the field null and the total UNAVAILABLE', async () => {
  const responses = new Map();
  responses.set(key(['repo', 'list', 'WickTech', '--limit', '200', '--json', 'name,url,pushedAt,isArchived,defaultBranchRef']), JSON.stringify([
    { name: 'busy-repo', url: 'u1', pushedAt: '2026-09-26T00:00:00Z', isArchived: false, defaultBranchRef: { name: 'main' } },
  ]));
  const twoHundred = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ number: i + 1 })));
  responses.set(key(['pr', 'list', '--repo', 'WickTech/busy-repo', '--state', 'open', '--limit', '200', '--json', 'number']), twoHundred);
  responses.set(key(['issue', 'list', '--repo', 'WickTech/busy-repo', '--state', 'open', '--limit', '200', '--json', 'number']), '[]');
  responses.set(key(['run', 'list', '--repo', 'WickTech/busy-repo', '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']), '[]');
  responses.set(key(['api', '--paginate', 'repos/WickTech/busy-repo/commits?since=2026-09-20T08:00:00.000Z&per_page=100', '--jq', 'length']), '3');

  const runGh = async (args) => {
    const k = key(args);
    if (!responses.has(k)) throw new Error(`unexpected gh call: ${k}`);
    return responses.get(k);
  };

  const section = await collectGithub({ runGh, now: NOW, config: CONFIG });
  assert.equal(section.repos[0].openPRs, null);
  assert.equal(section.totals.openPRs.status, 'UNAVAILABLE');
});
