import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext } from '../types.js';
import { MANAGED_ID, existingJson, section, stringify } from './common.js';

/**
 * Cline CLI.
 *
 * Cline keeps provider settings in `~/.cline/data/settings/providers.json` and
 * remembers the last provider it used. anyagent registers an OpenAI-compatible
 * provider under its own key and selects it, so switching back to a
 * hand-configured provider is a menu choice inside Cline rather than a restore.
 */
export const cline: Agent = {
  id: 'cline',
  name: 'Cline',
  description: 'Autonomous coding agent with parallel task execution',
  homepage: 'https://cline.bot',
  wires: ['openai-chat'],
  bin: ['cline'],
  install: {
    command: ['npm', 'install', '-g', 'cline'],
    url: 'https://docs.cline.bot',
  },

  reads: (ctx) => [providersPath(ctx.home)],

  plan(ctx: PlanContext): LaunchPlan {
    const file = providersPath(ctx.home);
    const config = existingJson(ctx, file);
    const { target } = ctx;

    const provider = section(config, 'providers', MANAGED_ID);
    const settings = section(provider, 'settings');
    settings.provider = 'openai';
    settings.model = target.model.id;
    settings.baseUrl = target.baseUrl;
    settings.apiKey = target.apiKey;
    if (target.model.contextLimit) settings.contextWindow = target.model.contextLimit;
    if (target.model.outputLimit) settings.maxTokens = target.model.outputLimit;

    provider.tokenSource = 'manual';
    provider.updatedAt = ctx.now;

    config.version = 1;
    config.lastUsedProvider = MANAGED_ID;

    return {
      command: { file: 'cline', args: [...ctx.passthrough] },
      env: {},
      files: [{ path: file, contents: stringify(config), mode: 0o600, backup: true }],
      notes: [`Provider "${MANAGED_ID}" selected in ${file}.`],
    };
  },

  ownedFiles: (ctx) => [providersPath(ctx.home)],
};

function providersPath(home: string): string {
  return path.join(home, '.cline', 'data', 'settings', 'providers.json');
}
