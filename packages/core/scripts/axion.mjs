#!/usr/bin/env node
// Thin CLI: orchestrator entry point (AC-31).

import { main } from '../src/orchestrator/cli.mjs';

process.exitCode = await main(process.argv.slice(2), {
  rootDir: process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  isTTY: Boolean(process.stdin.isTTY),
});
