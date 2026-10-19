import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPlan } from '../src/orchestrator/run.mjs';
import { createExecutors } from '../src/orchestrator/executors.mjs';
import { formatRunLog, appendRunLog, toOrchestratorSection } from '../src/orchestrator/log.mjs';
import { REGISTRY, escapeControlChars } from '../src/orchestrator/registry.mjs';

const REAL_CONFIG = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config', 'axion.config.json'), 'utf8'));

async function tmpDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function step(n, agent, risk, dependsOn = []) {
  return { n, agent, input: `input-${n}`, dependsOn, risk, description: `desc-${n}` };
}

// ---- AC-37: runPlan with mocked executors --------------------------------

test('AC-37: a denied step and its dependents are skipped; independent steps still run', async () => {
  const plan = {
    steps: [
      step(1, 'operator', 'write'),
      step(2, 'developer', 'write', [1]),
      step(3, 'scout', 'read'),
    ],
  };
  const calls = [];
  const executors = {
    runAgent: async (s) => { calls.push(s.agent); return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10 }; },
    runScript: async (s) => { calls.push(s.agent); return { exitCode: 0, stdout: '', stderr: '', durationMs: 5 }; },
    runClaude: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 5 }),
    runShell: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 5 }),
  };
  const approve = async () => ({ approved: false, reason: 'denied by user' });

  const { results, exitCode, outcome } = await runPlan({ plan, executors, approve, timeoutMs: 1000 });
  assert.deepEqual(calls, ['scout']);
  assert.equal(results[0].decision, 'DENIED');
  assert.equal(results[1].decision, 'SKIPPED');
  assert.equal(results[1].note, 'dependency 1 denied');
  assert.equal(results[2].decision, 'AUTO');
  assert.equal(exitCode, 2);
  assert.equal(outcome, 'DENIED');
});

test('AC-37: a failed step skips its dependents with "dependency <n> failed"', async () => {
  const plan = {
    steps: [
      step(1, 'scout', 'read'),
      step(2, 'advisor', 'read', [1]),
    ],
  };
  const executors = {
    runAgent: async (s) => (s.agent === 'scout' ? { exitCode: 1, stdout: '', stderr: 'boom', durationMs: 1 } : { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runScript: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runClaude: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runShell: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
  };
  const approve = async () => ({ approved: true, reason: null });
  const { results, exitCode, outcome } = await runPlan({ plan, executors, approve, timeoutMs: 1000 });
  assert.equal(results[0].decision, 'AUTO');
  assert.equal(results[0].exitCode, 1);
  assert.equal(results[1].decision, 'SKIPPED');
  assert.equal(results[1].note, 'dependency 1 failed');
  assert.equal(exitCode, 1);
  assert.equal(outcome, 'FAILED');
});

test('AC-37: all steps succeed -> exitCode 0, COMPLETED', async () => {
  const plan = { steps: [step(1, 'scout', 'read')] };
  const executors = {
    runAgent: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runScript: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runClaude: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runShell: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
  };
  const { exitCode, outcome } = await runPlan({ plan, executors, approve: async () => ({ approved: true, reason: null }), timeoutMs: 1000 });
  assert.equal(exitCode, 0);
  assert.equal(outcome, 'COMPLETED');
});

test('review IMPORTANT #7: runPlan derives risk from the registry, never from a (possibly spoofed) step.risk', async () => {
  // A planner-authored (or otherwise tampered) plan claims risk:"read" for a
  // shell step. runPlan must still gate it on the registry's real risk
  // ("shell") and prompt for approval — it must not trust step.risk.
  const plan = { steps: [{ n: 1, agent: 'shell', input: 'echo hi', dependsOn: [], risk: 'read', description: 'desc' }] };
  let approveCalls = 0;
  let shellCalls = 0;
  const executors = {
    runAgent: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runScript: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runClaude: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runShell: async () => { shellCalls += 1; return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }; },
  };
  const approve = async () => { approveCalls += 1; return { approved: true, reason: null }; };
  const { results } = await runPlan({ plan, executors, approve, timeoutMs: 1000 });
  assert.equal(approveCalls, 1, 'a spoofed risk:"read" must still require approval');
  assert.equal(shellCalls, 1);
  assert.equal(results[0].decision, 'APPROVED');
  assert.equal(results[0].risk, 'shell', 'the recorded risk must be the registry\'s, not the spoofed one');
});

// review round 2 CRITICAL #1: even if a plan somehow reaches runPlan with an
// agent name that is not a real, own-property REGISTRY entry (e.g. a bug
// upstream in routeTask/validatePlan, or a direct/test call), runPlan must
// refuse outright — no approve() call, no executor call of any kind, and
// definitely never a fall-through to runShell.
for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
  test(`CRITICAL #1: runPlan refuses an unknown agent "${name}" without calling approve() or any executor`, async () => {
    const plan = { steps: [{ n: 1, agent: name, input: 'echo PWNED', dependsOn: [], risk: 'read', description: 'desc' }] };
    let approveCalls = 0;
    let anyExecutorCalls = 0;
    const executors = {
      runAgent: async () => { anyExecutorCalls += 1; return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }; },
      runScript: async () => { anyExecutorCalls += 1; return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }; },
      runClaude: async () => { anyExecutorCalls += 1; return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }; },
      runShell: async () => { anyExecutorCalls += 1; return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }; },
    };
    const approve = async () => { approveCalls += 1; return { approved: true, reason: null }; };
    const { results, exitCode } = await runPlan({ plan, executors, approve, timeoutMs: 1000 });
    assert.equal(approveCalls, 0, 'an unknown agent must never even reach the approval prompt');
    assert.equal(anyExecutorCalls, 0, 'an unknown agent must never reach any executor, especially not runShell');
    assert.equal(results[0].decision, 'DENIED');
    assert.match(results[0].note, /unknown agent/);
    assert.equal(exitCode, 2);
  });
}

test('transitive skip: step 3 depends on step 2, which depends on denied step 1', async () => {
  const plan = {
    steps: [
      step(1, 'operator', 'write'),
      step(2, 'developer', 'write', [1]),
      step(3, 'content', 'write', [2]),
    ],
  };
  const executors = {
    runAgent: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runScript: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runClaude: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
    runShell: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
  };
  const approve = async () => ({ approved: false, reason: 'denied by user' });
  const { results, exitCode } = await runPlan({ plan, executors, approve, timeoutMs: 1000 });
  assert.equal(results[0].decision, 'DENIED');
  assert.equal(results[1].decision, 'SKIPPED');
  assert.equal(results[1].note, 'dependency 1 denied');
  assert.equal(results[2].decision, 'SKIPPED');
  assert.equal(results[2].note, 'dependency 2 denied');
  assert.equal(exitCode, 2);
});

// ---- AC-38: executors with a fake spawnImpl -------------------------------

function fakeChild({ exitCode = 0, stdout = '', stderr = '', closeDelay = 1 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  }, closeDelay);
  return child;
}

test('AC-38: agent steps spawn claude -p with prompt text + task input, confinement flags and --allowedTools', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  await fs.mkdir(path.join(dir, 'prompts'), { recursive: true });
  await fs.writeFile(path.join(dir, 'prompts', 'scout.md'), 'SCOUT PROMPT');
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return fakeChild({ exitCode: 0, stdout: 'done' });
  };
  const config = { agents: { scout: { allowedTools: ['Read', 'Write'], disallowedTools: ['Bash(rm:*)'] } } };
  const executors = createExecutors({ rootDir: dir, config, spawnImpl });
  const result = await executors.runAgent({ agent: 'scout', input: 'do the thing' }, { timeoutMs: 5000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'done');
  assert.equal(calls[0].command, 'claude');
  const args = calls[0].args;
  assert.equal(args[0], '-p');
  // Confinement (review CRITICAL #1): --allowedTools alone is additive to
  // inherited settings, so every agent also gets --permission-mode dontAsk
  // and excludes the "user" setting source. The prompt is the last argv
  // element, after a `--` terminator (review round 2 MINOR #8), so a
  // prompt/task string starting with "-" can never be parsed as an option.
  assert.deepEqual(args.slice(1), [
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project,local',
    '--allowedTools', 'Read', 'Write',
    '--disallowedTools', 'Bash(rm:*)',
    '--', 'SCOUT PROMPT\n\n## Task input\ndo the thing',
  ]);
  assert.equal(calls[0].options.cwd, dir);
  assert.equal(calls[0].options.stdio[0], 'ignore');
  assert.ok(!calls[0].options.shell);
});

test('AC-38/CRITICAL #1: a missing prompt file is a hard failure — no spawn happens', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-'); // no prompts/ directory at all
  let spawnCalls = 0;
  const spawnImpl = () => { spawnCalls += 1; return fakeChild({ exitCode: 0 }); };
  const config = { agents: { scout: { allowedTools: ['Read'] } } };
  const executors = createExecutors({ rootDir: dir, config, spawnImpl });
  const result = await executors.runAgent({ agent: 'scout', input: 'x' }, { timeoutMs: 5000 });
  assert.equal(spawnCalls, 0, 'a missing prompt file must never spawn claude');
  assert.equal(result.exitCode, 'SPAWN_ERROR');
  assert.match(result.stderr, /prompt file not found/);
});

test('AC-38: build-data/validate spawn node with the script path', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  const calls = [];
  const spawnImpl = (command, args, options) => { calls.push({ command, args, options }); return fakeChild({ exitCode: 0 }); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  await executors.runScript({ agent: 'build-data' }, { timeoutMs: 5000 });
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, ['scripts/build-data.mjs']);
});

test('AC-38/CRITICAL #1: claude executor confinement — dontAsk, project/local settings, strict MCP, deny Bash', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  const calls = [];
  const spawnImpl = (command, args, options) => { calls.push({ command, args, options }); return fakeChild({ exitCode: 0 }); };
  const config = { executors: { claude: { allowedTools: ['Read'] } } };
  const executors = createExecutors({ rootDir: dir, config, spawnImpl });
  await executors.runClaude({ input: 'free form prompt' }, { timeoutMs: 5000 });
  assert.deepEqual(calls[0].args, [
    '-p',
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--allowedTools', 'Read',
    '--disallowedTools', 'Bash',
    '--', 'free form prompt',
  ]);
});

test('AC-38: only the shell executor passes shell:true, and shell gets no claude confinement flags', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  const calls = [];
  const spawnImpl = (command, args, options) => { calls.push({ command, args, options }); return fakeChild({ exitCode: 0, stdout: 'hi' }); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  await executors.runShell({ input: 'echo hi' }, { timeoutMs: 5000 });
  assert.equal(calls[0].command, 'echo hi');
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.shell, true);
});

test('AC-38: a shell executor mock is never called when approval is denied', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  let shellCalls = 0;
  const spawnImpl = () => { shellCalls += 1; return fakeChild({ exitCode: 0 }); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  const plan = { steps: [step(1, 'shell', 'shell')] };
  await runPlan({ plan, executors, approve: async () => ({ approved: false, reason: 'denied by user' }), timeoutMs: 1000 });
  assert.equal(shellCalls, 0);
});

test('AC-38: a timeout kills the child and records TIMEOUT', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  let killCalls = 0;
  let killSignal = null;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { killCalls += 1; killSignal = sig; };
    // never closes
    return child;
  };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  const result = await executors.runShell({ input: 'sleep forever' }, { timeoutMs: 20 });
  assert.equal(result.exitCode, 'TIMEOUT');
  assert.equal(killCalls, 1, 'the timed-out child must be killed');
  assert.equal(killSignal, 'SIGKILL');
});

test('AC-38: a spawn error records SPAWN_ERROR', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  const spawnImpl = () => { throw new Error('spawn failed'); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  const result = await executors.runShell({ input: 'nope' }, { timeoutMs: 1000 });
  assert.equal(result.exitCode, 'SPAWN_ERROR');
});

// ---- CRITICAL #1: exact confinement argv for every agent in the real config

// A literal table, not derived from the implementation's own STRICT_MCP_AGENTS
// set: advisor/search/researcher/developer/content and the generic `claude`
// step never need a live MCP connector, so they get --strict-mcp-config.
// scout and operator do need the user's Gmail/Vercel/Supabase connectors and
// must NOT get it (or every connector call would be blocked).
const EXPECTED_STRICT_MCP = {
  scout: false,
  operator: false,
  developer: true,
  content: true,
  advisor: true,
  search: true,
  researcher: true,
};

for (const [name, expectStrictMcp] of Object.entries(EXPECTED_STRICT_MCP)) {
  test(`CRITICAL #1: ${name} is spawned with dontAsk + project,local settings + its config allow/deny lists`, async (t) => {
    const dir = await tmpDir(t, 'axion-exec-');
    const promptFile = REGISTRY[name].promptFile;
    await fs.mkdir(path.join(dir, path.dirname(promptFile)), { recursive: true });
    await fs.writeFile(path.join(dir, promptFile), `${name} prompt`);
    const calls = [];
    const spawnImpl = (command, args, options) => { calls.push({ command, args, options }); return fakeChild({ exitCode: 0 }); };
    const executors = createExecutors({ rootDir: dir, config: REAL_CONFIG, spawnImpl });
    await executors.runAgent({ agent: name, input: 'task text' }, { timeoutMs: 5000 });

    assert.equal(calls.length, 1);
    const args = calls[0].args;
    assert.equal(args[0], '-p');
    // The prompt is the last argv element, after a `--` terminator (review
    // round 2 MINOR #8), so it can never be parsed as an option.
    assert.equal(args[args.length - 2], '--');
    const prompt = args[args.length - 1];
    assert.ok(prompt.includes(`${name} prompt`));
    assert.ok(prompt.includes('## Task input\ntask text'));

    const rest = args.slice(1, -2);
    assert.equal(rest[0], '--permission-mode');
    assert.equal(rest[1], 'dontAsk');
    assert.equal(rest[2], '--setting-sources');
    assert.equal(rest[3], 'project,local');

    let idx = 4;
    if (expectStrictMcp) {
      assert.equal(rest[idx], '--strict-mcp-config', `${name} must get --strict-mcp-config`);
      idx += 1;
    } else {
      assert.notEqual(rest[idx], '--strict-mcp-config', `${name} must NOT get --strict-mcp-config (it needs a live connector)`);
    }

    const allowedTools = REAL_CONFIG.agents[name].allowedTools;
    assert.equal(rest[idx], '--allowedTools');
    assert.deepEqual(rest.slice(idx + 1, idx + 1 + allowedTools.length), allowedTools, 'each tool must be its own argv element');
    idx += 1 + allowedTools.length;

    const disallowedTools = REAL_CONFIG.agents[name].disallowedTools || [];
    if (disallowedTools.length > 0) {
      assert.equal(rest[idx], '--disallowedTools');
      assert.deepEqual(rest.slice(idx + 1), disallowedTools);
    }

    // No agent may hold an unscoped Write/Edit/Read — every Write/Edit
    // entry must be scoped under data/** and Read scoped to the repo
    // (review round 1 CRITICAL #1, round 2 IMPORTANT #3).
    for (const tool of allowedTools) {
      if (tool === 'Write' || tool === 'Edit' || tool === 'Read') {
        assert.fail(`${name} has an unscoped ${tool} tool — must be scoped`);
      }
    }
  });
}

test('CRITICAL #1: no agent config can Write/Edit outside data/**', () => {
  for (const [name, cfg] of Object.entries(REAL_CONFIG.agents)) {
    for (const tool of cfg.allowedTools) {
      if (/^(Write|Edit)\(/.test(tool)) {
        assert.match(tool, /^\w+\(data\/\*\*\)$/, `${name}.${tool} must be scoped to data/**`);
      } else {
        assert.ok(tool !== 'Write' && tool !== 'Edit', `${name} must not hold an unscoped Write/Edit`);
      }
    }
  }
});

// review round 2 IMPORTANT #3: an unscoped Read plus unrestricted WebFetch
// is a no-approval exfiltration channel under prompt injection (search and
// researcher are read-risk, run with no approval, and ingest untrusted web
// content). Scoped here for every agent, not just those two.
//
// review round 3 IMPORTANT (new): a broad `Read(~/**)` deny was wrong for
// this project specifically, because the repo lives under $HOME
// (/home/rishi/github/axion) and deny rules beat allow rules — that deny
// would have blocked every agent from reading its own repo. `Read(./**)`
// as the only allow already confines reads to the repo; the deny list now
// names specific sensitive paths instead of the whole home directory.
const SENSITIVE_DENY_PATTERNS = [
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.config/gh/**)',
  'Read(~/.claude/**)',
  'Read(~/.gnupg/**)',
];

test('review IMPORTANT #3: no agent config holds an unscoped Read, and every one denies specific sensitive paths (not the whole home dir)', () => {
  for (const [name, cfg] of Object.entries(REAL_CONFIG.agents)) {
    for (const tool of cfg.allowedTools) {
      assert.notEqual(tool, 'Read', `${name} must not hold an unscoped Read tool`);
      if (/^Read\(/.test(tool)) {
        assert.match(tool, /^Read\(\.\/\*\*\)$/, `${name}.${tool} must be scoped to the repo (./**)`);
      }
    }
    const denies = cfg.disallowedTools || [];
    assert.ok(
      !denies.includes('Read(~/**)'),
      `${name} must not deny the whole home directory — the repo lives under $HOME and that would block reading it`,
    );
    for (const pattern of SENSITIVE_DENY_PATTERNS) {
      assert.ok(denies.includes(pattern), `${name} must explicitly deny ${pattern}`);
    }
  }
});

test('review IMPORTANT #3: search and researcher (Read + WebFetch) both have scoped Read and the sensitive-path denies', () => {
  for (const name of ['search', 'researcher']) {
    const cfg = REAL_CONFIG.agents[name];
    assert.ok(cfg.allowedTools.includes('WebFetch'));
    assert.ok(cfg.allowedTools.includes('Read(./**)'));
    assert.ok(!cfg.allowedTools.includes('Read'));
    for (const pattern of SENSITIVE_DENY_PATTERNS) {
      assert.ok((cfg.disallowedTools || []).includes(pattern));
    }
  }
});

// ---- AC-40 / AC-41: log + orchestrator section ---------------------------

test('AC-40: formatRunLog produces exact lines for a mixed AUTO/DENIED/SKIPPED run', () => {
  const results = [
    { n: 1, agent: 'operator', risk: 'write', decision: 'DENIED', exitCode: null, durationMs: null, note: 'denied by user', stdout: '', stderr: '' },
    { n: 2, agent: 'developer', risk: 'write', decision: 'SKIPPED', exitCode: null, durationMs: null, note: 'dependency 1 denied', stdout: '', stderr: '' },
    { n: 3, agent: 'scout', risk: 'read', decision: 'AUTO', exitCode: 0, durationMs: 1234, note: null, stdout: 'hello', stderr: 'warn' },
  ];
  const text = formatRunLog({ task: 'a task with a | pipe\nand a newline', startedAt: '2026-09-27T08:00:00Z', results });
  const lines = text.split('\n');
  assert.equal(lines[0], '## Orchestrator run 2026-09-27T08:00:00Z — a task with a / pipe and a newline');
  assert.equal(lines[2], '1 | operator | write | DENIED | - | - | denied by user');
  assert.equal(lines[3], '2 | developer | write | SKIPPED | - | - | dependency 1 denied');
  assert.equal(lines[4], '3 | scout | read | AUTO | 0 | 1.2s | -');
  assert.ok(text.includes('### Output'));
  assert.ok(text.includes('hello'));
  assert.ok(text.includes('warn'));
  assert.ok(!text.includes('#### Step 1'), 'a DENIED step must not get an Output subsection');
  assert.ok(!text.includes('#### Step 2'), 'a SKIPPED step must not get an Output subsection');
  assert.ok(text.includes('#### Step 3'));
});

test('AC-40/A12: a failed step\'s note carries the failure reason, never "-"', () => {
  const results = [
    { n: 1, agent: 'scout', risk: 'read', decision: 'AUTO', exitCode: 1, durationMs: 5, note: 'exit code 1', stdout: '', stderr: '' },
  ];
  const text = formatRunLog({ task: 'x', startedAt: '2026-09-27T08:00:00Z', results });
  assert.match(text.split('\n')[2], /exit code 1$/);
});

test('AC-40: task text is truncated to 200 characters', () => {
  const longTask = 'x'.repeat(250);
  const text = formatRunLog({ task: longTask, startedAt: '2026-09-27T08:00:00Z', results: [] });
  const heading = text.split('\n')[0];
  const taskPart = heading.split(' — ')[1];
  assert.equal(taskPart.length, 200);
});

test('AC-40: appendRunLog creates the file and directory if missing', async (t) => {
  const dir = await tmpDir(t, 'axion-log-');
  await appendRunLog(dir, '## Orchestrator run x\n');
  const text = await fs.readFile(path.join(dir, 'data', 'orchestrator-log.md'), 'utf8');
  assert.match(text, /## Orchestrator run x/);
});

// ---- follow-up review MINOR: "no tests for the new hardening" -----------
// (registry freeze, executor kind checks, bidi escaping in escapeControlChars,
// and the two executors.mjs "unknown agent" stderr sites left unescaped in
// the prior pass). Each test here fails if that specific hardening is later
// reverted, per the follow-up review's rule candidate "give every hardening
// change a test that fails if it is reverted."

test('follow-up review: REGISTRY and every entry are frozen', () => {
  assert.ok(Object.isFrozen(REGISTRY), 'REGISTRY itself must be frozen');
  for (const [name, entry] of Object.entries(REGISTRY)) {
    assert.ok(Object.isFrozen(entry), `REGISTRY.${name} must be frozen`);
  }
  // A write attempt must not silently succeed (it throws in strict-mode ESM).
  assert.throws(() => { REGISTRY.scout.risk = 'shell'; });
  assert.equal(REGISTRY.scout.risk, 'read', 'freeze must actually prevent the mutation, not just throw');
});

test('follow-up review: runAgent refuses a real registry entry whose kind is not "agent"', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  let spawnCalls = 0;
  const spawnImpl = () => { spawnCalls += 1; return fakeChild({ exitCode: 0 }); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  for (const nonAgentName of ['shell', 'claude', 'build-data', 'validate']) {
    const result = await executors.runAgent({ agent: nonAgentName, input: 'x' }, { timeoutMs: 5000 });
    assert.equal(result.exitCode, 'SPAWN_ERROR', `runAgent must refuse kind!=='agent' entry "${nonAgentName}"`);
    assert.match(result.stderr, /unknown agent/);
  }
  assert.equal(spawnCalls, 0, 'none of these must ever spawn a process via runAgent');
});

test('follow-up review: runScript refuses a real registry entry whose kind is not "script"', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  let spawnCalls = 0;
  const spawnImpl = () => { spawnCalls += 1; return fakeChild({ exitCode: 0 }); };
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  for (const nonScriptName of ['scout', 'shell', 'claude']) {
    const result = await executors.runScript({ agent: nonScriptName }, { timeoutMs: 5000 });
    assert.equal(result.exitCode, 'SPAWN_ERROR', `runScript must refuse kind!=='script' entry "${nonScriptName}"`);
  }
  assert.equal(spawnCalls, 0, 'none of these must ever spawn a process via runScript');
});

test('follow-up review: runAgent/runScript escape control chars and bidi marks in the "unknown agent" stderr', async (t) => {
  const dir = await tmpDir(t, 'axion-exec-');
  const spawnImpl = () => fakeChild({ exitCode: 0 });
  const executors = createExecutors({ rootDir: dir, config: {}, spawnImpl });
  const evilName = 'evil‮name\r\x1b[2K'; // RLO + CR + ESC[2K
  const escaped = escapeControlChars(evilName);
  const agentResult = await executors.runAgent({ agent: evilName, input: 'x' }, { timeoutMs: 5000 });
  const scriptResult = await executors.runScript({ agent: evilName }, { timeoutMs: 5000 });
  assert.equal(agentResult.stderr, `unknown agent: ${escaped}`);
  assert.equal(scriptResult.stderr, `unknown agent: ${escaped}`);
  // The raw control/bidi bytes must not appear unescaped in the stderr shown
  // to a human terminal.
  assert.doesNotMatch(agentResult.stderr, /[\u0000-\u001F\u007F-\u009F‪-‮]/);
  assert.doesNotMatch(scriptResult.stderr, /[\u0000-\u001F\u007F-\u009F‪-‮]/);
});

test('follow-up review: escapeControlChars escapes Unicode bidi/format characters, not just C0/C1', () => {
  const cases = [
    ['​', '\\u200b'], // zero-width space
    ['‎', '\\u200e'], // LRM
    ['‮', '\\u202e'], // RLO
    ['⁦', '\\u2066'], // LRI (isolate)
    ['﻿', '\\ufeff'], // BOM
    ['­', '\\u00ad'], // soft hyphen (follow-up review addition)
    ['؜', '\\u061c'], // Arabic letter mark (follow-up review addition)
    [' ', '\\u2028'], // line separator (follow-up review addition)
  ];
  for (const [input, expected] of cases) {
    assert.equal(escapeControlChars(`a${input}b`), `a${expected}b`, `must escape U+${input.codePointAt(0).toString(16)}`);
  }
  // An ordinary ASCII name must be a no-op — escaping must not corrupt the
  // exact-string "unknown agent: toString" style messages elsewhere.
  assert.equal(escapeControlChars('toString'), 'toString');
  assert.equal(escapeControlChars('plain ascii input, no funny business'), 'plain ascii input, no funny business');
});

test('AC-41: toOrchestratorSection builds totals and lastRun', () => {
  const results = [
    { n: 1, agent: 'scout', risk: 'read', decision: 'AUTO', exitCode: 0, durationMs: 1, note: null, stdout: '', stderr: '' },
    { n: 2, agent: 'operator', risk: 'write', decision: 'APPROVED', exitCode: 1, durationMs: 1, note: null, stdout: '', stderr: '' },
  ];
  const section = toOrchestratorSection({ task: 'scout then operator', startedAt: '2026-09-27T08:00:00Z', results, outcome: 'FAILED', asOf: '2026-09-27T08:01:00Z' });
  assert.equal(section.status, 'OK');
  assert.equal(section.lastRun.outcome, 'FAILED');
  assert.equal(section.totals.steps.value, 2);
  assert.equal(section.totals.auto.value, 1);
  assert.equal(section.totals.approved.value, 1);
  assert.equal(section.totals.failed.value, 1);
  assert.equal(section.totals.denied.value, 0);
  assert.equal(section.totals.skipped.value, 0);
});
