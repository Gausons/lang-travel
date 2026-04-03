#!/usr/bin/env node

import { runCli } from './cli.js';

try {
  runCli();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`错误: ${msg}`);
  process.exit(1);
}

