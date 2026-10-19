#!/usr/bin/env node
// Thin CLI: writes data/sources/github.json (AC-8).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { collectGithub, defaultRunGh } from '../src/collectors/github.mjs';
import { writeAtomic } from '../src/build-data.mjs';

async function main() {
  const rootDir = process.cwd();
  const configText = await fs.readFile(path.join(rootDir, 'config', 'axion.config.json'), 'utf8');
  const config = JSON.parse(configText);

  const section = await collectGithub({ runGh: defaultRunGh, now: new Date(), config });

  const outPath = path.join(rootDir, 'data', 'sources', 'github.json');
  await writeAtomic(outPath, `${JSON.stringify(section, null, 2)}\n`);

  if (section.status === 'UNAVAILABLE') {
    process.stderr.write(`warning: github section UNAVAILABLE: ${section.reason}\n`);
  }
  process.exitCode = 0;
}

main().catch((err) => {
  process.stderr.write(`collect failed: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
