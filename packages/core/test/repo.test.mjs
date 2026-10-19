import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
// packages/core lives two levels below the monorepo root (CI workflow and lockfile live there).
const monorepoRoot = path.resolve(rootDir, '..', '..');

test('AC-60: CI workflow runs on push/pull_request with the expected steps', async () => {
  const text = await fs.readFile(path.join(monorepoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(text.includes('actions/checkout@v4'));
  assert.ok(text.includes('actions/setup-node@v4'));
  assert.ok(text.includes('node-version: 22'));
  assert.ok(text.includes('cache: npm'));
  assert.ok(text.includes('npm ci'));
  assert.ok(text.includes('npm test'));
  assert.ok(text.includes('npm run validate'));
  assert.match(text, /on:\s*\n\s*push:/);
  assert.match(text, /pull_request:/);
});

async function walk(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full, exts)));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test('AC-61: .env.example lists AXION_PORT and every process.env.<NAME> used in src/scripts', async () => {
  const envExample = await fs.readFile(path.join(rootDir, '.env.example'), 'utf8');
  assert.ok(envExample.includes('AXION_PORT=4173'));

  const files = [
    ...(await walk(path.join(rootDir, 'src'), ['.mjs'])),
    ...(await fs.readdir(path.join(rootDir, 'scripts'))).map((f) => path.join(rootDir, 'scripts', f)).filter((f) => f.endsWith('.mjs')),
  ];

  const names = new Set();
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    const re = /process\.env\.([A-Z0-9_]+)/g;
    let m;
    while ((m = re.exec(text))) {
      names.add(m[1]);
    }
  }

  assert.ok(names.size > 0, 'expected at least one process.env.<NAME> reference');
  for (const name of names) {
    assert.ok(envExample.includes(`${name}=`), `.env.example is missing ${name}`);
  }
});

test('AC-62: the monorepo package-lock.json exists, is valid JSON, and pins this workspace and jsdom (npm ci itself is run manually, not from inside the suite)', async () => {
  const lock = JSON.parse(await fs.readFile(path.join(monorepoRoot, 'package-lock.json'), 'utf8'));
  const rootPkg = JSON.parse(await fs.readFile(path.join(monorepoRoot, 'package.json'), 'utf8'));
  assert.equal(lock.name, rootPkg.name);
  assert.ok(lock.packages['packages/core'], 'the lockfile must include the packages/core workspace');
  assert.ok(lock.packages, 'lockfile must be in the npm v7+ "packages" format that npm ci understands');
  assert.ok(lock.packages['node_modules/jsdom'], 'the lockfile must pin jsdom, the only devDependency');
});
