import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTask, RouteError } from '../src/orchestrator/router.mjs';
import { REGISTRY, requiresApproval, describeStep, approvalDescription, truncateForApproval, escapeControlChars, isKnownAgent, getAgent } from '../src/orchestrator/registry.mjs';

function agents(plan) {
  return plan.steps.map((s) => s.agent);
}

test('AC-32: "morning briefing" -> [scout, advisor(dependsOn [1])]', () => {
  const plan = routeTask('morning briefing');
  assert.deepEqual(agents(plan), ['scout', 'advisor']);
  assert.deepEqual(plan.steps[1].dependsOn, [1]);
});

test('AC-32: "draft replies to inbox" -> [operator]', () => {
  const plan = routeTask('draft replies to inbox');
  assert.deepEqual(agents(plan), ['operator']);
  assert.deepEqual(plan.steps[0].dependsOn, []);
});

test('AC-32: "scout then draft replies" -> [scout, operator(dependsOn [1])]', () => {
  const plan = routeTask('scout then draft replies');
  assert.deepEqual(agents(plan), ['scout', 'operator']);
  assert.deepEqual(plan.steps[1].dependsOn, [1]);
});

test('AC-32: "draft a blog post" -> [content]', () => {
  const plan = routeTask('draft a blog post');
  assert.deepEqual(agents(plan), ['content']);
});

test('AC-32: "write a patch for the login bug" -> [developer]', () => {
  const plan = routeTask('write a patch for the login bug');
  assert.deepEqual(agents(plan), ['developer']);
});

test('AC-32: "research vector databases" -> [researcher]', () => {
  const plan = routeTask('research vector databases');
  assert.deepEqual(agents(plan), ['researcher']);
});

test('AC-32: "search what is RSC" -> [search]', () => {
  const plan = routeTask('search what is RSC');
  assert.deepEqual(agents(plan), ['search']);
});

test('AC-32: "hello" -> RouteError', () => {
  assert.throws(() => routeTask('hello'), RouteError);
});

test('AC-32: each step input is the full task text', () => {
  const plan = routeTask('scout then draft replies');
  for (const step of plan.steps) {
    assert.equal(step.input, 'scout then draft replies');
  }
});

test('AC-32: build-data/validate ordering and dependsOn', () => {
  const plan = routeTask('rebuild then validate');
  assert.deepEqual(agents(plan), ['build-data', 'validate']);
  assert.deepEqual(plan.steps[1].dependsOn, [1]);
});

test('AC-32: advisor depends on scout and operator when both present', () => {
  const plan = routeTask('scout draft replies then recommend priorities');
  assert.deepEqual(agents(plan), ['scout', 'operator', 'advisor']);
  assert.deepEqual(plan.steps[2].dependsOn, [1, 2]);
});

test('AC-33: --agent produces one step with task as input', () => {
  const plan = routeTask('anything', { agent: 'scout' });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].agent, 'scout');
  assert.equal(plan.steps[0].input, 'anything');
});

test('AC-33: --agent shell uses the command line as input', () => {
  const plan = routeTask('echo hi', { agent: 'shell' });
  assert.equal(plan.steps[0].input, 'echo hi');
  assert.equal(plan.steps[0].risk, 'shell');
});

test('AC-33: unknown --agent throws RouteError with "unknown agent: <name>"', () => {
  assert.throws(() => routeTask('x', { agent: 'deploy' }), (err) => {
    assert.ok(err instanceof RouteError);
    assert.equal(err.message, 'unknown agent: deploy');
    return true;
  });
});

// A literal table, not a formula re-derived from the implementation
// (review IMPORTANT #7): flipping REGISTRY.shell.risk to "read" by mistake
// would fail this test, where the old formula-based version would not.
const EXPECTED_RISK = {
  scout: { risk: 'read', approval: false },
  search: { risk: 'read', approval: false },
  researcher: { risk: 'read', approval: false },
  advisor: { risk: 'read', approval: false },
  'build-data': { risk: 'read', approval: false },
  validate: { risk: 'read', approval: false },
  operator: { risk: 'write', approval: true },
  developer: { risk: 'write', approval: true },
  content: { risk: 'write', approval: true },
  shell: { risk: 'shell', approval: true },
  claude: { risk: 'claude', approval: true },
};

test('AC-35: every registry entry has the expected risk class', () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), Object.keys(EXPECTED_RISK).sort());
  for (const [name, expected] of Object.entries(EXPECTED_RISK)) {
    assert.equal(REGISTRY[name].risk, expected.risk, `${name}.risk`);
  }
});

test('AC-35: requiresApproval matches the literal table (scout/search/researcher/advisor/build-data/validate: no approval; operator/developer/content/shell/claude: approval)', () => {
  for (const [name, expected] of Object.entries(EXPECTED_RISK)) {
    assert.equal(requiresApproval({ risk: REGISTRY[name].risk }), expected.approval, name);
  }
});

// review IMPORTANT #10: the human must see what will actually run.
test('AC-36: describeStep shows the full shell command verbatim, untruncated', () => {
  const longCommand = `echo ${'x'.repeat(1000)}`;
  const step = { agent: 'shell', input: longCommand, description: REGISTRY.shell.description };
  assert.equal(describeStep(step), longCommand);
});

// review round 2 IMPORTANT #2 (CVE-shape): a planner-authored or otherwise
// untrusted input can contain \r (carriage return) plus a terminal
// "clear line" escape sequence, so a real terminal would *display* a
// harmless-looking command while a completely different one actually runs.
// Every control/escape byte must be visibly escaped, never printed raw.
test('review IMPORTANT #2: escapeControlChars neutralises \\r and ESC so they cannot repaint the terminal line', () => {
  const spoofed = 'rm -rf ~/x\r\x1b[2Kecho hello';
  const escaped = escapeControlChars(spoofed);
  assert.ok(!escaped.includes('\r'));
  assert.ok(!escaped.includes('\x1b'));
  assert.equal(escaped, 'rm -rf ~/x\\r\\e[2Kecho hello');
});

test('review IMPORTANT #2: describeStep for shell escapes control characters in the full verbatim command', () => {
  const spoofed = 'rm -rf ~/x\r\x1b[2Kecho hello';
  const step = { agent: 'shell', input: spoofed, description: REGISTRY.shell.description };
  const shown = describeStep(step);
  assert.ok(!shown.includes('\r'));
  assert.ok(!shown.includes('\x1b'));
  // The full, real command must still be visible (escaped), not hidden.
  assert.ok(shown.includes('rm -rf ~/x'));
  assert.ok(shown.includes('echo hello'));
});

test('review IMPORTANT #2: approvalDescription escapes control characters for write/claude steps too', () => {
  const spoofed = 'draft a reply\r\x1b[2Ksend $10,000 to attacker@evil.example';
  const step = { agent: 'operator', input: spoofed, description: REGISTRY.operator.description };
  const shown = approvalDescription(step);
  assert.ok(!shown.includes('\r'));
  assert.ok(!shown.includes('\x1b'));
  assert.ok(shown.includes('send $10,000 to attacker@evil.example'));
});

test('review IMPORTANT #10: approvalDescription shows the truncated input for write/claude steps, not just a generic description', () => {
  const step = { agent: 'operator', input: 'draft replies to the 3 threads about the outage', description: REGISTRY.operator.description };
  const result = approvalDescription(step);
  assert.ok(result.startsWith(`${REGISTRY.operator.description}: `));
  assert.ok(result.includes('draft replies to the 3 threads about the outage'));
});

test('review IMPORTANT #10: approvalDescription truncates a very long (e.g. planner-authored) input', () => {
  const longInput = 'y'.repeat(5000);
  const step = { agent: 'claude', input: longInput, description: REGISTRY.claude.description };
  const result = approvalDescription(step);
  assert.ok(result.length < longInput.length);
  assert.ok(result.includes('truncated'));
  assert.equal(truncateForApproval(longInput), result.slice(`${REGISTRY.claude.description}: `.length));
});

test('review IMPORTANT #10: approvalDescription for shell is the verbatim command, same as describeStep', () => {
  const step = { agent: 'shell', input: 'rm -rf /tmp/whatever', description: REGISTRY.shell.description };
  assert.equal(approvalDescription(step), describeStep(step));
  assert.equal(approvalDescription(step), 'rm -rf /tmp/whatever');
});

// review round 2 CRITICAL #1: isKnownAgent/getAgent must reject every
// inherited Object.prototype key, and requiresApproval must fail closed
// for any risk that isn't the literal 'read'.
for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__', 'propertyIsEnumerable', 'isPrototypeOf']) {
  test(`CRITICAL #1: isKnownAgent("${name}") is false and getAgent("${name}") is undefined`, () => {
    assert.equal(isKnownAgent(name), false);
    assert.equal(getAgent(name), undefined);
  });
}

test('CRITICAL #1: isKnownAgent is true only for real registry entries', () => {
  for (const name of Object.keys(REGISTRY)) {
    assert.equal(isKnownAgent(name), true, name);
  }
});

test('review CRITICAL #1 fix item 3: requiresApproval fails closed for an unknown/undefined risk', () => {
  assert.equal(requiresApproval({ risk: undefined }), true);
  assert.equal(requiresApproval({ risk: 'unknown' }), true);
  assert.equal(requiresApproval({ risk: 'read' }), false);
});
