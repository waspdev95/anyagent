#!/usr/bin/env node
/**
 * Run the compiled test suite.
 *
 * `node --test "dir/*.test.js"` only understands glob patterns from Node 22
 * onwards - on Node 20 it reports "Could not find" and exits 1. Enumerating the
 * files here keeps one command working identically on every supported release,
 * and gives extra flags (`--watch`, `--test-reporter`) somewhere to go.
 *
 * Usage: node scripts/test.mjs [extra node flags]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.test-out', 'test');

let entries;
try {
  entries = fs.readdirSync(dir);
} catch {
  console.error(`No compiled tests in ${path.relative(root, dir)}. Run \`npm test\`.`);
  process.exit(1);
}

const files = entries
  .filter((entry) => entry.endsWith('.test.js'))
  .sort()
  .map((entry) => path.join(dir, entry));

if (files.length === 0) {
  console.error(`No *.test.js files in ${path.relative(root, dir)}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
  cwd: root,
});

process.exit(result.status ?? 1);
