/**
 * The provider and model catalog.
 *
 * Three sources, in priority order, so the CLI is fast, current and offline-safe:
 *
 *   1. `~/.anyagent/cache/catalog.json` when it is fresh
 *   2. models.dev over the network (only when a command actually needs fresh
 *      data - launching an agent never blocks on a request)
 *   3. the snapshot bundled in the npm package
 *
 * Everything is merged with the curated overlay in `data/overlay.ts`, which is
 * where the Anthropic-compatible endpoints and hard-coded base URLs live.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import type { Model, Provider, Wire } from './types.js';
import { EXTRA_PROVIDERS, PROVIDER_OVERLAY, wiresForSdk } from './data/overlay.js';
import { parseJson, readJson, writeJson } from './fsx.js';

export const CATALOG_URL = 'https://models.dev/api.json';
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RawModel {
  id?: string;
  name?: string;
  context?: number;
  output?: number;
  tool?: number;
  reasoning?: number;
  attachment?: number;
  in?: number;
  out?: number;
}

interface RawProvider {
  id: string;
  name?: string;
  doc?: string;
  env?: string[];
  npm?: string;
  api?: string;
  models: Record<string, RawModel>;
}

interface RawCatalog {
  source?: string;
  generatedAt: string;
  providers: Record<string, RawProvider>;
}

export interface Catalog {
  generatedAt: string;
  origin: 'cache' | 'network' | 'bundled';
  providers: Provider[];
  /** Models keyed by provider id, in catalog order. */
  models: Map<string, Model[]>;
  /** Providers we know about but cannot drive, with the reason. */
  unsupported: Map<string, string>;
}

export interface LoadOptions {
  cacheFile: string;
  /** Try the network when the cache is missing or stale. */
  refresh?: boolean;
  /** Force a network fetch regardless of cache age. */
  force?: boolean;
  maxAgeMs?: number;
  timeoutMs?: number;
  now?: number;
  fetchImpl?: typeof fetch;
}

let bundledCache: RawCatalog | undefined;

/** Read the snapshot that ships inside the package. */
export function loadBundledCatalog(): RawCatalog {
  if (bundledCache) return bundledCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, 'data', 'catalog.snapshot.json.gz');
  const gzipped = fs.readFileSync(file);
  bundledCache = parseJson<RawCatalog>(gunzipSync(gzipped).toString('utf8'), file);
  return bundledCache;
}

export async function loadCatalog(options: LoadOptions): Promise<Catalog> {
  const maxAge = options.maxAgeMs ?? CATALOG_MAX_AGE_MS;
  const now = options.now ?? Date.now();

  const cached = await readJson<RawCatalog | null>(options.cacheFile, null);
  const fresh = cached !== null && now - Date.parse(cached.generatedAt) < maxAge;

  if (cached && fresh && !options.force) return build(cached, 'cache');

  if (options.refresh || options.force) {
    const downloaded = await fetchCatalog(options).catch(() => null);
    if (downloaded) {
      await writeJson(options.cacheFile, downloaded).catch(() => {});
      return build(downloaded, 'network');
    }
  }

  if (cached) return build(cached, 'cache');

  const bundled = loadBundledCatalog();
  return build(bundled, 'bundled');
}

/** Fetch and trim models.dev. Shape matches the bundled snapshot exactly. */
export async function fetchCatalog(
  options: Pick<LoadOptions, 'timeoutMs' | 'fetchImpl'>,
): Promise<RawCatalog> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await doFetch(CATALOG_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
    return trim((await response.json()) as Record<string, UpstreamProvider>);
  } finally {
    clearTimeout(timer);
  }
}

interface UpstreamProvider {
  name?: string;
  doc?: string;
  env?: string[];
  npm?: string;
  api?: string;
  models?: Record<string, UpstreamModel>;
}

interface UpstreamModel {
  id?: string;
  name?: string;
  limit?: { context?: number; output?: number };
  tool_call?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  cost?: { input?: number; output?: number };
}

function trim(upstream: Record<string, UpstreamProvider>): RawCatalog {
  const providers: Record<string, RawProvider> = {};
  for (const [id, provider] of Object.entries(upstream)) {
    const models: Record<string, RawModel> = {};
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      models[modelId] = {
        id: model.id ?? modelId,
        name: model.name ?? modelId,
        context: model.limit?.context,
        output: model.limit?.output,
        tool: model.tool_call === true ? 1 : undefined,
        reasoning: model.reasoning === true ? 1 : undefined,
        attachment: model.attachment === true ? 1 : undefined,
        in: model.cost?.input,
        out: model.cost?.output,
      };
    }
    providers[id] = {
      id,
      name: provider.name ?? id,
      doc: provider.doc,
      env: provider.env,
      npm: provider.npm,
      api: provider.api,
      models,
    };
  }
  return { source: CATALOG_URL, generatedAt: new Date().toISOString(), providers };
}

/** Merge raw catalog data with the curated overlay. */
export function build(raw: RawCatalog, origin: Catalog['origin']): Catalog {
  const providers: Provider[] = [];
  const models = new Map<string, Model[]>();
  const unsupported = new Map<string, string>();

  for (const raws of Object.values(raw.providers)) {
    const overlay = PROVIDER_OVERLAY[raws.id] ?? {};
    if (overlay.unsupported) {
      unsupported.set(raws.id, overlay.unsupported);
      continue;
    }

    const baseUrl = mergeBaseUrls(raws, overlay.baseUrl);
    if (Object.keys(baseUrl).length === 0) {
      unsupported.set(raws.id, 'No HTTP endpoint is published for this provider.');
      continue;
    }

    providers.push({
      id: raws.id,
      name: overlay.name ?? raws.name ?? raws.id,
      doc: raws.doc,
      console: overlay.console,
      env: overlay.env ?? raws.env ?? [],
      baseUrl,
      headers: overlay.headers,
      keyless: overlay.keyless,
      local: overlay.local,
      keyPrefix: overlay.keyPrefix,
    });
    models.set(raws.id, Object.values(raws.models).map(toModel));
  }

  for (const extra of Object.values(EXTRA_PROVIDERS)) {
    if (models.has(extra.id)) continue;
    providers.push(extra);
    models.set(extra.id, []);
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { generatedAt: raw.generatedAt, origin, providers, models, unsupported };
}

function mergeBaseUrls(
  raw: RawProvider,
  overlay: Partial<Record<Wire, string>> | undefined,
): Partial<Record<Wire, string>> {
  const merged: Partial<Record<Wire, string>> = {};
  for (const wire of wiresForSdk(raw.npm)) {
    if (raw.api) merged[wire] = normalizeBase(raw.api);
  }
  for (const [wire, url] of Object.entries(overlay ?? {})) {
    if (url) merged[wire as Wire] = normalizeBase(url);
  }
  return merged;
}

/** Trim a trailing slash so we can join paths without doubling separators. */
export function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function toModel(raw: RawModel): Model {
  const model: Model = {
    id: raw.id ?? '',
    name: raw.name ?? raw.id ?? '',
    contextLimit: raw.context,
    outputLimit: raw.output,
    toolCall: raw.tool === 1,
    reasoning: raw.reasoning === 1,
    attachment: raw.attachment === 1,
  };
  if (raw.in !== undefined || raw.out !== undefined) {
    model.cost = { input: raw.in, output: raw.out };
  }
  return model;
}

/** Find a provider by exact id, then case-insensitively, then by display name. */
export function findProvider(catalog: Catalog, query: string): Provider | undefined {
  const needle = query.trim();
  return (
    catalog.providers.find((provider) => provider.id === needle) ??
    catalog.providers.find((provider) => provider.id.toLowerCase() === needle.toLowerCase()) ??
    catalog.providers.find((provider) => provider.name.toLowerCase() === needle.toLowerCase())
  );
}

export function providerModels(catalog: Catalog, providerId: string): Model[] {
  return catalog.models.get(providerId) ?? [];
}

/** Providers that can drive a given wire protocol. */
export function providersForWire(catalog: Catalog, wire: Wire): Provider[] {
  return catalog.providers.filter((provider) => provider.baseUrl[wire]);
}
