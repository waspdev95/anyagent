#!/usr/bin/env node
/**
 * Rebuild the bundled catalog snapshot from models.dev.
 *
 * The published API is ~4 MB of JSON. anyagent only needs a fraction of each
 * model record, so we trim first and gzip second - the result is small enough
 * to ship in the npm package, which is what lets the CLI work fully offline on
 * a fresh install.
 *
 * Usage: npm run snapshot
 */
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = process.env.ANYAGENT_CATALOG_URL ?? 'https://models.dev/api.json';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'data', 'catalog.snapshot.json.gz');

const response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
if (!response.ok) {
  console.error(`models.dev returned ${response.status}`);
  process.exit(1);
}
const raw = await response.json();

const providers = {};
for (const [id, provider] of Object.entries(raw)) {
  const models = {};
  for (const [modelId, model] of Object.entries(provider.models ?? {})) {
    models[modelId] = compact({
      id: model.id ?? modelId,
      name: model.name,
      context: model.limit?.context,
      output: model.limit?.output,
      tool: model.tool_call === true ? 1 : undefined,
      reasoning: model.reasoning === true ? 1 : undefined,
      attachment: model.attachment === true ? 1 : undefined,
      in: model.cost?.input,
      out: model.cost?.output,
    });
  }
  providers[id] = compact({
    id,
    name: provider.name ?? id,
    doc: provider.doc,
    env: provider.env?.length ? provider.env : undefined,
    npm: provider.npm,
    api: provider.api,
    models,
  });
}

const snapshot = {
  source: SOURCE,
  generatedAt: new Date().toISOString(),
  providers,
};

const json = JSON.stringify(snapshot);
const gzipped = gzipSync(Buffer.from(json), { level: 9 });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, gzipped);

const providerCount = Object.keys(providers).length;
const modelCount = Object.values(providers).reduce(
  (total, provider) => total + Object.keys(provider.models).length,
  0,
);
console.log(
  `snapshot: ${providerCount} providers, ${modelCount} models, ` +
    `${(json.length / 1e6).toFixed(2)} MB -> ${(gzipped.length / 1e3).toFixed(0)} KB gzipped`,
);
console.log(`written to ${path.relative(root, target)}`);

function compact(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) delete object[key];
  }
  return object;
}
