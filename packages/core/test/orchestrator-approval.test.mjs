import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { askApproval } from '../src/orchestrator/approval.mjs';

function makeStreams() {
  const input = new PassThrough();
  let written = '';
  const output = new PassThrough();
  output.on('data', (c) => { written += c.toString(); });
  return { input, output, getWritten: () => written };
}

test('AC-36: non-TTY denies without writing a prompt', async () => {
  const { input, output, getWritten } = makeStreams();
  const result = await askApproval({ question: 'Run step 1: x?', input, output, isTTY: false });
  assert.deepEqual(result, { approved: false, reason: 'approval required (no TTY)' });
  assert.equal(getWritten(), '');
});

test('AC-36: "y" approves', async () => {
  const { input, output } = makeStreams();
  const p = askApproval({ question: 'Run step 1: x?', input, output, isTTY: true });
  input.write('y\n');
  const result = await p;
  assert.deepEqual(result, { approved: true, reason: null });
});

test('AC-36: "Y" approves (case-insensitive)', async () => {
  const { input, output } = makeStreams();
  const p = askApproval({ question: 'Run step 1: x?', input, output, isTTY: true });
  input.write('Y\n');
  const result = await p;
  assert.equal(result.approved, true);
});

test('AC-36: "n" denies', async () => {
  const { input, output } = makeStreams();
  const p = askApproval({ question: 'Run step 1: x?', input, output, isTTY: true });
  input.write('n\n');
  const result = await p;
  assert.deepEqual(result, { approved: false, reason: 'denied by user' });
});

test('AC-36: empty line denies', async () => {
  const { input, output } = makeStreams();
  const p = askApproval({ question: 'Run step 1: x?', input, output, isTTY: true });
  input.write('\n');
  const result = await p;
  assert.equal(result.approved, false);
});

test('AC-36: EOF denies', async () => {
  const { input, output } = makeStreams();
  const p = askApproval({ question: 'Run step 1: x?', input, output, isTTY: true });
  input.end();
  const result = await p;
  assert.equal(result.approved, false);
});

test('AC-36: writes the question with [y/N] suffix when isTTY', async () => {
  const { input, output, getWritten } = makeStreams();
  const p = askApproval({ question: 'Run step 1: echo hi?', input, output, isTTY: true });
  input.write('y\n');
  await p;
  assert.equal(getWritten(), 'Run step 1: echo hi? [y/N] ');
});
