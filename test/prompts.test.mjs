import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const RULE_6 = 'The orchestrator never runs a write, shell, or claude step without explicit human approval in the terminal.';
// AC-21 requires all six safety rules verbatim in every prompt, not just a
// sample of them (review IMPORTANT #12).
const SAFETY_RULES = [
  'Nothing sends, spends, or publishes autonomously.',
  'Every number has a source and a date.',
  'If a number cannot be verified, it is reported as "UNAVAILABLE" — never estimate.',
  'Drafts before execution: agents produce drafts; a human executes.',
  'Autonomy is earned: no agent gains a new permission without the human explicitly granting it.',
  RULE_6,
];

const COMMON = ['UNAVAILABLE', 'source', 'never estimate'];

const PROMPTS = {
  'prompts/scout.md': ['read-only'],
  'prompts/operator.md': ['never send', 'draft', 'escalate', 'DELEGATED'],
  'prompts/advisor.md': ['exactly 3', 'never use an UNAVAILABLE number as evidence', 'Routine day — no priority change'],
  'prompts/search.md': ['read-only', 'cite'],
  'prompts/researcher.md': ['read-only', 'cite', 'Conflicts'],
  'prompts/subagents/developer.md': ['never push', 'never send', 'draft'],
  'prompts/subagents/content.md': ['never publish', 'never send', 'draft'],
};

for (const [file, extra] of Object.entries(PROMPTS)) {
  test(`AC-21: ${file} contains all six safety rules and required strings`, async () => {
    const text = await fs.readFile(path.join(rootDir, file), 'utf8');
    assert.ok(text.includes('Hard rules'));
    for (const rule of SAFETY_RULES) {
      assert.ok(text.includes(rule), `missing rule: ${rule}`);
    }
    for (const s of [...COMMON, ...extra]) {
      assert.ok(text.includes(s), `${file} missing required string: ${s}`);
    }
    assert.ok(text.includes('## Task input'));
  });
}

test('AC-44: README contains safety rule 6', async () => {
  const text = await fs.readFile(path.join(rootDir, 'README.md'), 'utf8');
  assert.ok(text.includes(RULE_6));
});
