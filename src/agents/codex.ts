import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext, PlannedFile, Target } from '../types.js';
import { MANAGED_ID, managedDir } from './common.js';

/**
 * OpenAI Codex CLI.
 *
 * Configured entirely through `-c key=value` overrides, so `~/.codex/config.toml`
 * is never opened, never rewritten and never needs restoring.
 *
 * Codex requires an OpenAI *Responses* API endpoint - `wire_api = "chat"` was
 * removed in codex 0.14x and now fails at config load. anyagent therefore only
 * offers Codex the providers that actually serve `/responses`; the rest are
 * reported as incompatible up front instead of failing on the first turn.
 */
export const codex: Agent = {
  id: 'codex',
  name: 'Codex',
  description: "OpenAI's coding agent for the terminal",
  aliases: ['codex-cli'],
  homepage: 'https://developers.openai.com/codex/cli/',
  wires: ['openai-responses'],
  bin: ['codex'],
  versionArgs: ['--version'],
  install: {
    command: ['npm', 'install', '-g', '@openai/codex'],
    url: 'https://developers.openai.com/codex/cli/',
  },

  plan(ctx: PlanContext): LaunchPlan {
    const { target } = ctx;
    const keyEnv = 'ANYAGENT_CODEX_API_KEY';
    const files: PlannedFile[] = [];
    const notes = ['Codex config comes from -c overrides; ~/.codex/config.toml is untouched.'];

    const overrides = configOverrides(target, keyEnv);

    // Without a catalog entry Codex warns that model metadata is missing and
    // falls back to generic defaults. The catalog schema is only known-good
    // from 0.134 onwards, so older builds keep the simpler context-window hint.
    if (supportsModelCatalog(ctx.agentVersion)) {
      const catalogPath = path.join(managedDir(ctx, 'codex'), 'model-catalog.json');
      files.push({ path: catalogPath, contents: modelCatalog(target) });
      overrides.push(`model_catalog_json=${JSON.stringify(catalogPath)}`);
    } else {
      notes.push('Codex is older than 0.134; model metadata will use built-in defaults.');
    }

    const args = [
      ...overrides.flatMap((override) => ['-c', override]),
      '--model',
      target.model.id,
      ...ctx.passthrough,
    ];

    return {
      command: { file: 'codex', args },
      // A dedicated variable, so a real OPENAI_API_KEY in the environment is
      // neither read nor shadowed.
      env: { [keyEnv]: target.apiKey },
      files,
      notes,
    };
  },
};

/** Model catalog entries were introduced in codex 0.134.0. */
export function supportsModelCatalog(version: string | undefined): boolean {
  if (!version) return true; // unknown version: assume a current release
  return compareVersions(version, '0.134.0') >= 0;
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * A single-entry Codex model catalog.
 *
 * `experimental_supported_tools` is required by the current schema; omitting it
 * makes Codex refuse to start, so it is always present even when empty.
 */
export function modelCatalog(target: Target): string {
  const entry = {
    slug: target.model.id,
    display_name: target.model.name || target.model.id,
    context_window: target.model.contextLimit ?? 128_000,
    max_output_tokens: target.model.outputLimit ?? 16_384,
    shell_type: 'default',
    visibility: 'list',
    supported_in_api: true,
    priority: 0,
    truncation_policy: { mode: 'tokens', limit: 10_000 },
    input_modalities: target.model.attachment ? ['text', 'image'] : ['text'],
    base_instructions: '',
    support_verbosity: true,
    default_verbosity: 'low',
    supports_parallel_tool_calls: false,
    supports_reasoning_summaries: Boolean(target.model.reasoning),
    supported_reasoning_levels: [],
    experimental_supported_tools: [],
  };
  return `${JSON.stringify({ models: [entry] }, null, 2)}
`;
}

/**
 * The `-c` overrides that define and select the anyagent provider.
 * Values are TOML literals, so strings are quoted.
 */
export function configOverrides(target: Target, keyEnv: string): string[] {
  const provider = `model_providers.${MANAGED_ID}`;
  const overrides = [
    `model_provider="${MANAGED_ID}"`,
    `${provider}.name="${target.provider.name.replace(/"/g, '')}"`,
    `${provider}.base_url="${target.baseUrl}"`,
    `${provider}.wire_api="responses"`,
    `${provider}.env_key="${keyEnv}"`,
  ];

  // `model_max_output_tokens` is deliberately absent: Codex rejects it as an
  // unknown field. Output limits are carried by the model catalog instead.
  if (target.model.contextLimit) {
    overrides.push(`model_context_window=${target.model.contextLimit}`);
  }

  const headers = target.provider.headers;
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      overrides.push(`${provider}.http_headers.${quoteKey(name)}="${value}"`);
    }
  }

  return overrides;
}

/** TOML bare keys allow letters, digits, underscore and dash; quote the rest. */
function quoteKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : `"${key}"`;
}
