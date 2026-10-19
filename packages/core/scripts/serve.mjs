#!/usr/bin/env node
// Thin CLI: start the local read-only server (AC-20).

import { createAxionServer } from '../src/server.mjs';

const rootDir = process.cwd();
const port = Number(process.env.AXION_PORT) || 4173;

const server = createAxionServer({ rootDir });
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`AXION online: http://127.0.0.1:${port}\n`);
});
