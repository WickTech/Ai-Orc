import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecommendationsLog, selectFollowUps, normalizeAction } from '../src/lib/followups.mjs';

const NOW = new Date('2026-09-27T00:00:00Z');

test('AC-53: a DONE entry is excluded', () => {
  const text = '2026-09-25 | 1 | blocker | Fix the thing | DONE\n';
  const { open } = parseRecommendationsLog(text, NOW);
  assert.equal(open.length, 0);
});

test('AC-53: an 8-day-old entry is excluded', () => {
  const text = '2026-09-19 | 1 | blocker | Fix the thing | OPEN\n';
  const { open } = parseRecommendationsLog(text, NOW);
  assert.equal(open.length, 0);
});

test('AC-53: a same-day (ageDays 0) entry is excluded', () => {
  const text = '2026-09-27 | 1 | blocker | Fix the thing | OPEN\n';
  const { open } = parseRecommendationsLog(text, NOW);
  assert.equal(open.length, 0);
});

test('AC-53: latest-line-wins (OPEN earlier, DONE later) excludes the action', () => {
  const text = [
    '2026-09-20 | 1 | blocker | Fix the thing | OPEN',
    '2026-09-22 | 1 | blocker | Fix the thing | DONE',
  ].join('\n');
  const { open } = parseRecommendationsLog(text, NOW);
  assert.equal(open.length, 0);
});

test('AC-53: 3 malformed lines are counted', () => {
  const text = [
    '# a header, ignored',
    '',
    'not five fields',
    '2026-09-20 | 9 | blocker | bad rank | OPEN',
    '2099-01-01 | 1 | blocker | future date | OPEN',
    '2026-09-20 | 1 | blocker | Fix the thing | OPEN',
  ].join('\n');
  const { open, malformed } = parseRecommendationsLog(text, NOW);
  assert.equal(malformed, 3);
  assert.equal(open.length, 1);
});

test('AC-53: oldest-first ordering, no cap', () => {
  const lines = [];
  for (let i = 1; i <= 7; i += 1) {
    const day = String(27 - i).padStart(2, '0');
    lines.push(`2026-09-${day} | 1 | blocker | Action ${i} | OPEN`);
  }
  const text = lines.join('\n');
  const { open } = parseRecommendationsLog(text, NOW);
  assert.equal(open.length, 7);
  for (let i = 0; i < open.length - 1; i += 1) {
    assert.ok(open[i].ageDays >= open[i + 1].ageDays);
  }
});

test('normalizeAction trims, lowercases and collapses whitespace', () => {
  assert.equal(normalizeAction('  Fix   The   Thing  '), 'fix the thing');
});

// AC-54
test('AC-54: selectFollowUps removes today\'s actions and caps at 10', () => {
  const open = Array.from({ length: 12 }, (_, i) => ({ date: '2026-09-20', rank: 1, category: 'blocker', action: `Action ${i}`, ageDays: 7 }));
  open.push({ date: '2026-09-20', rank: 1, category: 'blocker', action: 'Today Action', ageDays: 7 });
  const result = selectFollowUps(open, ['Today Action']);
  assert.equal(result.length, 10);
  assert.ok(result.every((f) => f.action !== 'Today Action'));
  assert.deepEqual(Object.keys(result[0]).sort(), ['action', 'ageDays', 'date']);
});
