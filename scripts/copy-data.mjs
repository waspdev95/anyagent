#!/usr/bin/env node
/**
 * Copy non-TypeScript assets from `src/data` into a compiled output tree.
 *
 * tsc emits JavaScript only, so the bundled catalog snapshot has to be carried
 * across by hand - for `dist` when publishing, and for the test build so the
 * offline-fallback tests exercise the real file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'data');
const to = path.resolve(root, process.argv[2] ?? 'dist/data');

fs.mkdirSync(to, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(from)) {
  if (entry.endsWith('.ts')) continue;
  fs.copyFileSync(path.join(from, entry), path.join(to, entry));
  copied += 1;
}
console.log(`copied ${copied} data file(s) to ${path.relative(root, to)}`);
