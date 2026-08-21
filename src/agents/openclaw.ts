import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext } from '../types.js';
import {
  MANAGED_ID,
  asArray,
  existingJson,
  isManaged,
  modelEntry,
  section,
  stringify,
  type Json,
} from './common.js';

/**
 * OpenClaw (formerly Clawdbot/Moltbot).
 *
 * Providers live under `models.providers` in `~/.openclaw/openclaw.json`, and
 * the active model is `agents.defaults.model.primary`. anyagent writes one
 * provider and points the default at it, preserving every other key in the file.
 */
export const openclaw: Agent = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'Personal AI agent with a large skill library',
  aliases: ['clawdbot', 'moltbot'],
  homepage: 'https://docs.openclaw.ai',
  wires: ['openai-chat', 'anthropic'],
  bin: ['openclaw', 'clawdbot'],
  install: {
    command: ['npm', 'install', '-g', 'openclaw'],
    url: 'https://docs.openclaw.ai',
  },

  reads: (ctx) => [configPath(ctx.home)],

  plan(ctx: PlanContext): LaunchPlan {
    const file = configPath(ctx.home);
    const config = existingJson(ctx, file);
    const { target } = ctx;

    const provider = section(config, 'models', 'providers', MANAGED_ID);
    provider.name = `${target.provider.name} (anyagent)`;
    provider.baseUrl = target.baseUrl;
    provider.apiKey = target.apiKey;
    provider.api = target.wire === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
    if (target.provider.headers) provider.headers = target.provider.headers;

    const existingModels = asArray(provider.models).filter(
      (entry) => !isManaged(entry) && entryId(entry) !== target.model.id,
    );
    provider.models = [modelEntry(target), ...existingModels];

    const defaults = section(config, 'agents', 'defaults', 'model');
    defaults.primary = `${MANAGED_ID}/${target.model.id}`;

    return {
      command: { file: 'openclaw', args: [...ctx.passthrough] },
      env: {},
      files: [{ path: file, contents: stringify(config), mode: 0o600, backup: true }],
      notes: [`Primary model set to ${MANAGED_ID}/${target.model.id} in ${file}.`],
    };
  },

  ownedFiles: (ctx) => [configPath(ctx.home)],
};

function configPath(home: string): string {
  return path.join(home, '.openclaw', 'openclaw.json');
}

function entryId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const id = (entry as Json).id;
  return typeof id === 'string' ? id : undefined;
}
