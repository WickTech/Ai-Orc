import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixturePath = 'test/fixtures/mission-control.valid.json';

test('AC-3: exits 0 and prints VALID on a valid file', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['scripts/validate.mjs', fixturePath], { cwd: rootDir });
  assert.equal(stdout.trim(), `VALID ${fixturePath}`);
});

test('AC-3: exits 1 and prints errors on an invalid file', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/validate.mjs', 'test/fixtures/mission-control.invalid-for-cli.json'], { cwd: rootDir }),
    (err) => {
      assert.equal(err.code, 1);
      return true;
    },
  );
});

test('AC-3: exits 1 with "file not found: <path>" when the file is missing', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/validate.mjs', 'data/does-not-exist.json'], { cwd: rootDir }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /^file not found: data\/does-not-exist\.json/);
      return true;
    },
  );
});
