import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext, Target } from '../types.js';
import { MANAGED_ID } from './common.js';

/**
 * OpenCode.
 *
 * The cleanest integration of the set: OpenCode accepts its entire
 * configuration as JSON in `OPENCODE_CONFIG_CONTENT`, so anyagent adds a
 * provider for this process only. No file is written, nothing is restored, and
 * the user's own `opencode.json` keeps working untouched.
 */
export const opencode: Agent = {
  id: 'opencode',
  name: 'OpenCode',
  description: 'Open-source terminal coding agent',
  homepage: 'https://opencode.ai',
  wires: ['openai-chat'],
  bin: ['opencode'],
  install: {
    command: ['npm', 'install', '-g', 'opencode-ai'],
    url: 'https://opencode.ai',
  },
  extraPaths: (home) => [path.join(home, '.opencode', 'bin')],

  plan(ctx: PlanContext): LaunchPlan {
    return {
      command: { file: 'opencode', args: [...ctx.passthrough] },
      env: { OPENCODE_CONFIG_CONTENT: inlineConfig(ctx.target) },
      files: [],
      notes: ['Provider is injected for this session only; opencode.json is untouched.'],
    };
  },
};

/** Build the value of `OPENCODE_CONFIG_CONTENT`. */
export function inlineConfig(target: Target): string {
  const options: Record<string, unknown> = {
    baseURL: target.baseUrl,
    apiKey: target.apiKey,
  };
  if (target.provider.headers) options.headers = target.provider.headers;

  const limit: Record<string, number> = {};
  if (target.model.contextLimit) limit.context = target.model.contextLimit;
  if (target.model.outputLimit) limit.output = target.model.outputLimit;

  const model: Record<string, unknown> = {
    name: target.model.name || target.model.id,
    tool_call: target.model.toolCall !== false,
  };
  if (Object.keys(limit).length > 0) model.limit = limit;
  if (target.model.reasoning) model.reasoning = true;
  if (target.model.attachment) model.attachment = true;

  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [MANAGED_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: `${target.provider.name} (anyagent)`,
        options,
        models: { [target.model.id]: model },
      },
    },
    model: `${MANAGED_ID}/${target.model.id}`,
  });
}
