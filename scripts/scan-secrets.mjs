#!/usr/bin/env node
/**
 * Fail if anything that looks like a real API key is in the repository.
 *
 * anyagent handles credentials for a living, so its own repository is exactly
 * the kind of place one ends up by accident - pasted into a test, echoed into a
 * fixture, left in a debugging commit. This runs in CI on every push and can be
 * run by hand before making the repository public.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs             tracked files only (fast)
 *   node scripts/scan-secrets.mjs --history   every commit that ever existed
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Key shapes worth catching. Deliberately broad: a false positive costs someone
 * thirty seconds, a false negative costs them a rotated key and a bad afternoon.
 */
const PATTERNS = [
  /\bsk-or-v1-[A-Za-z0-9_-]{8,}/g, // OpenRouter
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bsk-proj-[A-Za-z0-9_-]{8,}/g, // OpenAI project
  /\bgsk_[A-Za-z0-9_-]{8,}/g, // Groq
  /\bxai-[A-Za-z0-9_-]{8,}/g, // xAI
  /\bcsk-[A-Za-z0-9_-]{8,}/g, // Cerebras
  /\btgp_v1_[A-Za-z0-9_-]{8,}/g, // Together
  /\bnvapi-[A-Za-z0-9_-]{8,}/g, // NVIDIA
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
];

/**
 * Fixtures the test suite needs. Every entry here is a string this repository
 * wrote on purpose; nothing that authenticates against anything.
 *
 * Adding to this list is a decision, not a formality: if a value could possibly
 * be real, rotate it instead.
 */
const ALLOWED = new Set([
  'sk-or-v1-testkey0000000000',
  'sk-or-v1-abcdef0123456789',
  'sk-or-v1-1234567890abcdef',
  'sk-or-v1-cikey0000000000000000',
  'gsk_abcdef0123456789',
  'gsk_storedkey123456',
  'gsk_friendlyname123',
]);

/** This file names every pattern and fixture, so it would flag itself. */
const SELF = path.join('scripts', 'scan-secrets.mjs');

const scanHistory = process.argv.includes('--history');
const findings = [];

function inspect(text, where) {
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!ALLOWED.has(match[0])) findings.push({ where, value: match[0] });
    }
  }
}

// Tracked files. Binary and generated data is skipped: the catalog snapshot is
// gzipped public model metadata.
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => !file.endsWith('.gz') && !file.endsWith('.png'))
  .filter((file) => path.normalize(file) !== SELF);

for (const file of tracked) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue; // unreadable or binary
  }
  inspect(text, file);
}

if (scanHistory) {
  // Every version of every file that was ever committed, including ones later
  // deleted - which is the case that matters before going public.
  const log = execFileSync('git', ['log', '-p', '--all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  inspect(log, 'git history');
}

if (findings.length > 0) {
  console.error('Possible credentials found:\n');
  for (const finding of findings) {
    const masked = `${finding.value.slice(0, 10)}...${finding.value.slice(-4)}`;
    console.error(`  ${finding.where}: ${masked}`);
  }
  console.error('\nIf one of these is real: revoke it at the provider, then rewrite history.');
  console.error('If it is a test fixture, add it to ALLOWED in scripts/scan-secrets.mjs.');
  process.exit(1);
}

console.log(
  `No credentials in ${tracked.length} tracked files${scanHistory ? ' or in git history' : ''}.`,
);
