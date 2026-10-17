#!/usr/bin/env node
// Thin CLI: prints only the slug (AC-28).

import { slugify } from '../src/lib/slug.mjs';

const topic = process.argv[2] || '';
process.stdout.write(`${slugify(topic)}\n`);
