import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { claude } from '../src/agents/claude.js';
import { codex } from '../src/agents/codex.js';
import { opencode } from '../src/agents/opencode.js';
import { findProvider, providersForWire } from '../src/catalog.js';
import { AnyAgentError } from '../src/errors.js';
import {
  buildTarget,
  negotiateWire,
  resolveModel,
  resolveProvider,
  splitQualifiedModel,
} from '../src/resolve.js';
import { fixtureCatalog } from './helpers.js';

const catalog = fixtureCatalog();

describe('provider resolution', () => {
  test('matches by id, case-insensitively, and by display name', () => {
    assert.equal(resolveProvider(catalog, 'openrouter').id, 'openrouter');
    assert.equal(resolveProvider(catalog, 'OpenRouter').id, 'openrouter');
    assert.equal(findProvider(catalog, 'Groq')?.id, 'groq');
  });

  test('explains why a provider cannot be driven at all', () => {
    // Bedrock signs requests with SigV4; a base URL and a bearer token are not
    // enough, and saying so beats failing at the first request.
    assert.ok(catalog.unsupported.has('amazon-bedrock'));
    assert.throws(
      () => resolveProvider(catalog, 'amazon-bedrock'),
      (error: AnyAgentError) => error.hint?.includes('SigV4') === true,
    );
  });

  test('suggests a correction for a typo', () => {
    assert.throws(
      () => resolveProvider(catalog, 'openroutr'),
      (error: AnyAgentError) => error.hint?.includes('openrouter') === true,
    );
  });

  test('asks for a provider rather than guessing one', () => {
    assert.throws(() => resolveProvider(catalog, undefined), AnyAgentError);
  });
});

describe('protocol negotiation', () => {
  test('claude only pairs with Anthropic-compatible endpoints', () => {
    assert.equal(negotiateWire(claude, resolveProvider(catalog, 'openrouter')), 'anthropic');
    assert.equal(negotiateWire(claude, resolveProvider(catalog, 'groq')), undefined);
  });

  test('codex only pairs with Responses endpoints', () => {
    assert.equal(negotiateWire(codex, resolveProvider(catalog, 'openrouter')), 'openai-responses');
    assert.equal(negotiateWire(codex, resolveProvider(catalog, 'anthropic')), undefined);
  });

  test('an incompatible pair names working alternatives', () => {
    assert.throws(
      () =>
        buildTarget({
          agent: claude,
          catalog,
          providerId: 'groq',
          modelId: 'llama-3.3-70b',
          apiKey: 'k',
        }),
      (error: AnyAgentError) => {
        assert.match(error.message, /cannot use Groq/);
        assert.match(error.hint ?? '', /openrouter/);
        return true;
      },
    );
  });

  test('providersForWire only lists endpoints that exist', () => {
    const anthropicCapable = providersForWire(catalog, 'anthropic').map((p) => p.id);
    // Ollama is always present: it serves an Anthropic-compatible API locally.
    assert.deepEqual(anthropicCapable.sort(), ['anthropic', 'ollama', 'openrouter']);
    assert.ok(!anthropicCapable.includes('groq'));
  });
});

describe('model resolution', () => {
  const openrouter = resolveProvider(catalog, 'openrouter');

  test('exact and case-insensitive matches', () => {
    assert.equal(
      resolveModel(catalog, openrouter, 'deepseek/deepseek-chat').id,
      'deepseek/deepseek-chat',
    );
    assert.equal(
      resolveModel(catalog, openrouter, 'DeepSeek/DeepSeek-Chat').id,
      'deepseek/deepseek-chat',
    );
  });

  test('a unique suffix is enough', () => {
    assert.equal(resolveModel(catalog, openrouter, 'deepseek-chat').id, 'deepseek/deepseek-chat');
  });

  test('an unknown model lists close matches instead of failing blankly', () => {
    assert.throws(
      () => resolveModel(catalog, openrouter, 'deepseek'),
      (error: AnyAgentError) => error.hint?.includes('deepseek/deepseek-chat') === true,
    );
  });

  test('providers with no catalog accept any id', () => {
    const local = { id: 'ollama', name: 'Ollama', env: [], baseUrl: { 'openai-chat': 'http://x' } };
    assert.equal(resolveModel(catalog, local, 'qwen3:8b').id, 'qwen3:8b');
  });

  test('carries limits and pricing through to the target', () => {
    const target = buildTarget({
      agent: opencode,
      catalog,
      providerId: 'openrouter',
      modelId: 'deepseek/deepseek-chat',
      apiKey: 'k',
    });
    assert.equal(target.model.contextLimit, 163_840);
    assert.equal(target.wire, 'openai-chat');
    assert.equal(target.baseUrl, 'https://openrouter.ai/api/v1');
  });

  test('--base-url overrides the catalog endpoint', () => {
    const target = buildTarget({
      agent: opencode,
      catalog,
      providerId: 'openrouter',
      modelId: 'deepseek/deepseek-chat',
      baseUrlOverride: 'http://127.0.0.1:8080/v1/',
      apiKey: 'k',
    });
    assert.equal(target.baseUrl, 'http://127.0.0.1:8080/v1');
  });
});

describe('provider-qualified model ids', () => {
  test('splits a known provider prefix', () => {
    assert.deepEqual(splitQualifiedModel(catalog, 'groq:llama-3.3-70b'), {
      provider: 'groq',
      model: 'llama-3.3-70b',
    });
  });

  test('leaves an Ollama-style tag alone', () => {
    // `qwen3:8b` is a tag, not provider `qwen3` - and no such provider exists.
    assert.deepEqual(splitQualifiedModel(catalog, 'qwen3:8b'), { model: 'qwen3:8b' });
  });

  test('prefers a real model id over a provider prefix', () => {
    const provider = resolveProvider(catalog, 'openrouter');
    const extended = fixtureCatalog();
    extended.models.get('openrouter')!.push({ id: 'groq:mixtral', name: 'odd id' });
    assert.deepEqual(splitQualifiedModel(extended, 'groq:mixtral', provider), {
      model: 'groq:mixtral',
    });
  });
});
