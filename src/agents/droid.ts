import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext } from '../types.js';
import { MANAGED_ID, asArray, existingJson, section, stringify, type Json } from './common.js';

/**
 * Factory's Droid.
 *
 * Droid has no environment override for its provider, so anyagent edits
 * `~/.factory/settings.json`. The edit is surgical: entries whose id starts
 * with the anyagent prefix are replaced, every other custom model the user
 * configured is carried over untouched, and the previous file is backed up so
 * `anyagent restore droid` can put it back exactly.
 */
export const droid: Agent = {
  id: 'droid',
  name: 'Droid',
  description: "Factory's coding agent for terminal and IDE",
  homepage: 'https://docs.factory.ai/cli',
  wires: ['openai-chat', 'anthropic'],
  bin: ['droid'],
  install: { url: 'https://docs.factory.ai/cli/getting-started/quickstart' },

  reads: (ctx) => [settingsPath(ctx.home)],

  plan(ctx: PlanContext): LaunchPlan {
    const file = settingsPath(ctx.home);
    const settings = existingJson(ctx, file);
    const { target } = ctx;

    const modelId = `${MANAGED_ID}:${target.model.id}`;
    const entry: Json = {
      id: modelId,
      model: target.model.id,
      displayName: `${target.model.name || target.model.id} (${target.provider.name})`,
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      provider: target.wire === 'anthropic' ? 'anthropic' : 'generic-chat-completion-api',
      maxOutputTokens: target.model.outputLimit ?? 64_000,
      supportsImages: Boolean(target.model.attachment),
      index: 0,
    };

    // Keep the user's own models; drop only previous anyagent entries.
    const preserved = asArray(settings.customModels).filter((model) => !isManagedEntry(model));
    settings.customModels = [
      entry,
      ...preserved.map((model, offset) => reindex(model, offset + 1)),
    ];

    const defaults = section(settings, 'sessionDefaultSettings');
    defaults.model = modelId;

    return {
      command: { file: 'droid', args: [...ctx.passthrough] },
      env: {},
      files: [{ path: file, contents: stringify(settings), mode: 0o600, backup: true }],
      notes: [`Custom model "${modelId}" written to ${file}.`],
    };
  },

  ownedFiles: (ctx) => [settingsPath(ctx.home)],
};

function settingsPath(home: string): string {
  return path.join(home, '.factory', 'settings.json');
}

function isManagedEntry(model: unknown): boolean {
  if (typeof model !== 'object' || model === null) return false;
  const id = (model as Json).id;
  return typeof id === 'string' && id.startsWith(`${MANAGED_ID}:`);
}

function reindex(model: unknown, index: number): unknown {
  if (typeof model !== 'object' || model === null) return model;
  return { ...(model as Json), index };
}
