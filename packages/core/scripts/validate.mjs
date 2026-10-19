#!/usr/bin/env node
// Thin CLI: validate a mission-control.json file (AC-3).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateMissionControl } from '../src/lib/schema.mjs';

async function main() {
  const rootDir = process.cwd();
  const arg = process.argv[2];
  const target = arg || 'data/mission-control.json';
  const fullPath = path.isAbsolute(target) ? target : path.join(rootDir, target);

  let text;
  try {
    text = await fs.readFile(fullPath, 'utf8');
  } catch {
    process.stdout.write(`file not found: ${target}\n`);
    process.exitCode = 1;
    return;
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    process.stdout.write(`invalid JSON in ${target}: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const { valid, errors } = validateMissionControl(obj);
  if (valid) {
    process.stdout.write(`VALID ${target}\n`);
    process.exitCode = 0;
  } else {
    for (const e of errors) process.stdout.write(`${e}\n`);
    process.exitCode = 1;
  }
}

main();
