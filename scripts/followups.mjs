#!/usr/bin/env node
// Thin CLI: prints { open, malformed } for data/recommendations-log.md (AC-54).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseRecommendationsLog } from '../src/lib/followups.mjs';

async function main() {
  const rootDir = process.cwd();
  const logPath = path.join(rootDir, 'data', 'recommendations-log.md');

  let text = '';
  try {
    text = await fs.readFile(logPath, 'utf8');
  } catch {
    text = '';
  }

  const result = parseRecommendationsLog(text, new Date());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 0;
}

main();
