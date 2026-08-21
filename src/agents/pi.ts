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
 * Pi, the minimal agent toolkit.
 *
 * Two files: `models.json` holds providers, `settings.json` picks the default.
 * anyagent owns a single provider entry and leaves every other provider - and
 * every model the user added by hand - exactly where it was.
 */
export const pi: Agent = {
  id: 'pi',
  name: 'Pi',
  description: 'Minimal agent toolkit with a plugin system',
  homepage: 'https://github.com/earendil-works/pi',
  wires: ['openai-chat'],
  bin: ['pi'],
  install: {
    command: ['npm', 'install', '-g', '@earendil-works/pi-coding-agent'],
    url: 'https://github.com/earendil-works/pi',
  },

  reads: (ctx) => [modelsPath(ctx.home), settingsPath(ctx.home)],

  plan(ctx: PlanContext): LaunchPlan {
    const { target } = ctx;
    const models = existingJson(ctx, modelsPath(ctx.home));
    const settings = existingJson(ctx, settingsPath(ctx.home));

    const provider = section(models, 'providers', MANAGED_ID);
    provider.baseUrl = target.baseUrl;
    provider.api = 'openai-completions';
    provider.apiKey = target.apiKey;
    if (target.provider.headers) provider.headers = target.provider.headers;

    // Preserve hand-written entries; replace the ones we wrote before.
    const userModels = asArray(provider.models).filter(
      (entry) => !isManaged(entry) && entryId(entry) !== target.model.id,
    );
    provider.models = [modelEntry(target), ...userModels];

    settings.defaultProvider = MANAGED_ID;
    settings.defaultModel = target.model.id;

    return {
      command: { file: 'pi', args: [...ctx.passthrough] },
      env: {},
      files: [
        { path: modelsPath(ctx.home), contents: stringify(models), mode: 0o600, backup: true },
        { path: settingsPath(ctx.home), contents: stringify(settings), backup: true },
      ],
      notes: [`Provider "${MANAGED_ID}" written to ${modelsPath(ctx.home)}.`],
    };
  },

  ownedFiles: (ctx) => [modelsPath(ctx.home), settingsPath(ctx.home)],
};

function modelsPath(home: string): string {
  return path.join(home, '.pi', 'agent', 'models.json');
}

function settingsPath(home: string): string {
  return path.join(home, '.pi', 'agent', 'settings.json');
}

function entryId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const id = (entry as Json).id;
  return typeof id === 'string' ? id : undefined;
}
