#!/usr/bin/env node
/**
 * Finish a production build: copy data assets and mark the bin executable.
 * npm sets the execute bit on install, but not for a local `node dist/cli.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'copy-data.mjs'), 'dist/data'], {
  stdio: 'inherit',
});

const bin = path.join(root, 'dist', 'cli.js');
if (fs.existsSync(bin) && process.platform !== 'win32') fs.chmodSync(bin, 0o755);
