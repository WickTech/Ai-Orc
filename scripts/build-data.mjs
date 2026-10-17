#!/usr/bin/env node
// Thin CLI: merge + write mission-control.json and history (AC-11, AC-57).

import { buildMissionControl, writeBuildOutputs } from '../src/build-data.mjs';

async function main() {
  const rootDir = process.cwd();
  const now = new Date();
  const { doc, errors } = await buildMissionControl({ rootDir, now });

  if (errors.length > 0) {
    process.stderr.write('build-data: merged document is invalid:\n');
    for (const e of errors) process.stderr.write(`  ${e}\n`);
    process.exitCode = 1;
    return;
  }

  await writeBuildOutputs({ rootDir, doc, now });
  process.stdout.write('OK data/mission-control.json\n');
  process.exitCode = 0;
}

main().catch((err) => {
  process.stderr.write(`build-data failed: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
