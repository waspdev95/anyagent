import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, type Catalog } from '../src/catalog.js';
import { setStreams } from '../src/ui.js';
import type { PlanContext, Target } from '../src/types.js';

/** A disposable directory, removed when the test process exits. */
export function tempDir(prefix = 'anyagent-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on('exit', () => {
    // Cleanup must never be the reason a test run fails: Windows happily
    // reports EBUSY on a directory something else still has open.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return dir;
}

/**
 * A small fixed catalog.
 *
 * Tests must not depend on models.dev: the point of a test is to fail when the
 * code changes, not when a provider adds a model.
 */
export function fixtureCatalog(): Catalog {
  return build(
    {
      generatedAt: '2026-01-01T00:00:00.000Z',
      providers: {
        openrouter: {
          id: 'openrouter',
          name: 'OpenRouter',
          npm: '@openrouter/ai-sdk-provider',
          api: 'https://openrouter.ai/api/v1',
          env: ['OPENROUTER_API_KEY'],
          models: {
            'deepseek/deepseek-chat': {
              id: 'deepseek/deepseek-chat',
              name: 'DeepSeek Chat',
              context: 163_840,
              output: 16_000,
              tool: 1,
            },
            'openai/gpt-5': {
              id: 'openai/gpt-5',
              name: 'GPT-5',
              context: 400_000,
              tool: 1,
              in: 1.25,
            },
          },
        },
        groq: {
          id: 'groq',
          name: 'Groq',
          npm: '@ai-sdk/groq',
          env: ['GROQ_API_KEY'],
          models: {
            'llama-3.3-70b': {
              id: 'llama-3.3-70b',
              name: 'Llama 3.3 70B',
              context: 131_072,
              tool: 1,
            },
          },
        },
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          npm: '@ai-sdk/anthropic',
          env: ['ANTHROPIC_API_KEY'],
          models: {
            'claude-sonnet-4-5': {
              id: 'claude-sonnet-4-5',
              name: 'Claude Sonnet 4.5',
              context: 200_000,
            },
          },
        },
        'amazon-bedrock': {
          id: 'amazon-bedrock',
          name: 'Amazon Bedrock',
          npm: '@ai-sdk/amazon-bedrock',
          env: ['AWS_ACCESS_KEY_ID'],
          models: {},
        },
      },
    },
    'bundled',
  );
}

export function fixtureTarget(overrides: Partial<Target> = {}): Target {
  const catalog = fixtureCatalog();
  const provider = catalog.providers.find((candidate) => candidate.id === 'openrouter')!;
  return {
    provider,
    wire: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or-v1-testkey0000000000',
    model: {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek Chat',
      contextLimit: 163_840,
      outputLimit: 16_000,
      toolCall: true,
    },
    ...overrides,
  };
}

export function fixtureContext(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    target: fixtureTarget(),
    passthrough: [],
    home: path.join(path.sep, 'home', 'tester'),
    stateDir: path.join(path.sep, 'home', 'tester', '.anyagent'),
    platform: 'linux',
    now: '2026-01-01T00:00:00.000Z',
    existing: new Map(),
    ...overrides,
  };
}

/**
 * Capture what anyagent prints while `fn` runs.
 *
 * This redirects the CLI's own sinks rather than `process.stdout`, so the test
 * runner's reporter keeps working normally.
 */
export async function captureOut(fn: () => unknown): Promise<string> {
  const chunks: string[] = [];
  const restore = setStreams({
    stdout: { write: (chunk: string) => chunks.push(chunk) },
    stderr: { write: (chunk: string) => chunks.push(chunk) },
  });
  try {
    await fn();
  } finally {
    restore();
  }
  return chunks.join('');
}
