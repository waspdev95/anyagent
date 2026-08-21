import assert from 'node:assert/strict';
import path from 'node:path';
import test, { describe } from 'node:test';

import {
  build,
  loadBundledCatalog,
  loadCatalog,
  normalizeBase,
  providerModels,
} from '../src/catalog.js';
import { PROVIDER_OVERLAY, wiresForSdk } from '../src/data/overlay.js';
import { writeJson } from '../src/fsx.js';
import { tempDir } from './helpers.js';

describe('SDK to protocol mapping', () => {
  test('maps the families anyagent can drive', () => {
    assert.deepEqual(wiresForSdk('@ai-sdk/anthropic'), ['anthropic']);
    assert.deepEqual(wiresForSdk('@ai-sdk/openai'), ['openai-responses', 'openai-chat']);
    assert.deepEqual(wiresForSdk('@ai-sdk/openai-compatible'), ['openai-chat']);
    assert.deepEqual(wiresForSdk(undefined), ['openai-chat']);
  });

  test('marks Gemini and Bedrock as undrivable through a base URL', () => {
    assert.deepEqual(wiresForSdk('@ai-sdk/google'), []);
    assert.deepEqual(wiresForSdk('@ai-sdk/amazon-bedrock'), []);
  });
});

describe('catalog assembly', () => {
  const raw = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    providers: {
      openrouter: {
        id: 'openrouter',
        name: 'OpenRouter',
        npm: '@openrouter/ai-sdk-provider',
        api: 'https://openrouter.ai/api/v1/',
        env: ['OPENROUTER_API_KEY'],
        models: { 'a/b': { id: 'a/b', name: 'A B', context: 100, tool: 1, in: 0 } },
      },
      mystery: { id: 'mystery', name: 'Mystery', models: {} },
    },
  };

  test('overlay adds the Anthropic endpoint the upstream data cannot know', () => {
    const catalog = build(raw, 'bundled');
    const openrouter = catalog.providers.find((provider) => provider.id === 'openrouter')!;
    assert.equal(openrouter.baseUrl.anthropic, 'https://openrouter.ai/api');
    assert.equal(openrouter.baseUrl['openai-chat'], 'https://openrouter.ai/api/v1');
    assert.equal(openrouter.keyPrefix, 'sk-or-');
    assert.ok(openrouter.headers?.['X-Title']);
  });

  test('providers with no endpoint at all are reported, not silently dropped', () => {
    const catalog = build(raw, 'bundled');
    assert.equal(
      catalog.providers.some((provider) => provider.id === 'mystery'),
      false,
    );
    assert.match(catalog.unsupported.get('mystery') ?? '', /No HTTP endpoint/);
  });

  test('local providers are added even though models.dev has no entry', () => {
    const catalog = build(raw, 'bundled');
    const ollama = catalog.providers.find((provider) => provider.id === 'ollama');
    assert.ok(ollama, 'ollama is missing');
    assert.equal(ollama.keyless, true);
    assert.equal(ollama.baseUrl.anthropic, 'http://127.0.0.1:11434');
  });

  test('model records keep limits, pricing and capabilities', () => {
    const catalog = build(raw, 'bundled');
    const [model] = providerModels(catalog, 'openrouter');
    assert.equal(model?.contextLimit, 100);
    assert.equal(model?.toolCall, true);
    assert.deepEqual(model?.cost, { input: 0, output: undefined });
  });

  test('trailing slashes are normalised away', () => {
    assert.equal(normalizeBase('https://x.dev/v1///'), 'https://x.dev/v1');
  });
});

describe('bundled snapshot', () => {
  test('ships a usable catalog for offline installs', () => {
    const bundled = loadBundledCatalog();
    const ids = Object.keys(bundled.providers);
    assert.ok(ids.length > 50, `only ${ids.length} providers in the snapshot`);
    assert.ok(ids.includes('openrouter'));
    assert.ok(Object.keys(bundled.providers.openrouter!.models).length > 10);
  });

  test('every curated overlay entry refers to a real provider or a local one', () => {
    const bundled = loadBundledCatalog();
    const known = new Set(Object.keys(bundled.providers));
    const local = new Set(['ollama', 'llamacpp', 'vllm']);
    for (const id of Object.keys(PROVIDER_OVERLAY)) {
      assert.ok(known.has(id) || local.has(id), `overlay entry "${id}" matches no provider`);
    }
  });

  test('every declared Anthropic endpoint records how it was verified', () => {
    for (const [id, entry] of Object.entries(PROVIDER_OVERLAY)) {
      if (entry.baseUrl?.anthropic) {
        assert.ok(entry.anthropicSource, `${id} declares an Anthropic endpoint with no source`);
      }
    }
  });
});

describe('catalog loading', () => {
  test('a fresh cache is used without touching the network', async () => {
    const cacheFile = path.join(tempDir(), 'catalog.json');
    await writeJson(cacheFile, {
      generatedAt: new Date().toISOString(),
      providers: { groq: { id: 'groq', name: 'Groq', npm: '@ai-sdk/groq', models: {} } },
    });
    const catalog = await loadCatalog({
      cacheFile,
      refresh: true,
      fetchImpl: () => {
        throw new Error('network must not be used for a fresh cache');
      },
    });
    assert.equal(catalog.origin, 'cache');
  });

  test('a network failure falls back to the bundled snapshot', async () => {
    const catalog = await loadCatalog({
      cacheFile: path.join(tempDir(), 'missing.json'),
      refresh: true,
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    assert.equal(catalog.origin, 'bundled');
    assert.ok(catalog.providers.length > 50);
  });

  test('a stale cache triggers a refresh and is rewritten', async () => {
    const cacheFile = path.join(tempDir(), 'catalog.json');
    await writeJson(cacheFile, { generatedAt: '2000-01-01T00:00:00.000Z', providers: {} });

    const catalog = await loadCatalog({
      cacheFile,
      refresh: true,
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              groq: { name: 'Groq', npm: '@ai-sdk/groq', env: ['GROQ_API_KEY'], models: {} },
            }),
            { status: 200 },
          ),
        ),
    });

    assert.equal(catalog.origin, 'network');
    assert.ok(catalog.providers.some((provider) => provider.id === 'groq'));
  });
});
