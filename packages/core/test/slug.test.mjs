import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/lib/slug.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('AC-28: slugify basic cases', () => {
  assert.equal(slugify('Next.js 15 — Caching!'), 'next-js-15-caching');
  assert.equal(slugify(''), 'research');
  assert.equal(slugify('日本語'), 'research');
});

test('AC-28: slugify truncates to 60 chars with no trailing dash', () => {
  const input = 'a'.repeat(100);
  const result = slugify(input);
  assert.ok(result.length <= 60);
  assert.ok(!result.endsWith('-'));
});

test('AC-28: node scripts/slug.mjs prints only the slug', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['scripts/slug.mjs', 'Next.js 15 — Caching!'], { cwd: rootDir });
  assert.equal(stdout.trim(), 'next-js-15-caching');
});
