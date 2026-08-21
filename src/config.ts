/**
 * Layered configuration.
 *
 * Precedence, lowest to highest:
 *
 *   built-in defaults
 *   user config      ~/.anyagent/config.json
 *   project config   .anyagent.json, discovered by walking up from cwd
 *   environment      ANYAGENT_PROVIDER, ANYAGENT_MODEL, ...
 *   command flags
 *
 * Per-agent sections win over the global ones, so a repo can pin Claude Code to
 * a big model and Codex to a cheap one without any flags at the prompt.
 */

import path from 'node:path';

import { readJson, writeJson } from './fsx.js';
import { PROJECT_CONFIG_NAMES } from './paths.js';
import { pathExists } from './fsx.js';

export interface AgentDefaults {
  provider?: string;
  model?: string;
  smallModel?: string;
  /** Extra arguments always passed to this agent. */
  args?: string[];
}

export interface UserConfig extends AgentDefaults {
  /** Per-agent overrides, keyed by agent id. */
  agents?: Record<string, AgentDefaults>;
  /** Where API keys live. */
  credentialStore?: 'file' | 'keychain';
  /** Refresh the model catalog in the background when it goes stale. */
  autoRefreshCatalog?: boolean;
}

export const DEFAULT_CONFIG: UserConfig = {
  credentialStore: 'file',
  autoRefreshCatalog: true,
};

export interface ResolvedDefaults {
  provider?: string;
  model?: string;
  smallModel?: string;
  args: string[];
  /** Where each value came from, for `anyagent doctor`. */
  sources: Record<string, string>;
}

export async function loadUserConfig(file: string): Promise<UserConfig> {
  const stored = await readJson<UserConfig>(file, {});
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function saveUserConfig(file: string, config: UserConfig): Promise<void> {
  await writeJson(file, config);
}

/** Walk up from `cwd` looking for a project config. Returns the first hit. */
export async function findProjectConfig(cwd: string): Promise<string | undefined> {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (await pathExists(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function loadProjectConfig(
  cwd: string,
): Promise<{ file?: string; config: UserConfig }> {
  const file = await findProjectConfig(cwd);
  if (!file) return { config: {} };
  return { file, config: await readJson<UserConfig>(file, {}) };
}

export interface ResolveInput {
  agentId: string;
  user: UserConfig;
  project: UserConfig;
  projectFile?: string;
  env: NodeJS.ProcessEnv;
  flags: { provider?: string; model?: string; smallModel?: string };
}

/** Collapse every layer into the values a launch actually uses. */
export function resolveDefaults(input: ResolveInput): ResolvedDefaults {
  const sources: Record<string, string> = {};
  const result: ResolvedDefaults = { args: [], sources };

  const apply = (defaults: AgentDefaults | undefined, source: string): void => {
    if (!defaults) return;
    if (defaults.provider) {
      result.provider = defaults.provider;
      sources.provider = source;
    }
    if (defaults.model) {
      result.model = defaults.model;
      sources.model = source;
    }
    if (defaults.smallModel) {
      result.smallModel = defaults.smallModel;
      sources.smallModel = source;
    }
    if (defaults.args?.length) {
      result.args = [...result.args, ...defaults.args];
    }
  };

  apply(globalOf(input.user), 'user config');
  apply(input.user.agents?.[input.agentId], `user config (${input.agentId})`);
  const projectLabel = input.projectFile
    ? `project config (${input.projectFile})`
    : 'project config';
  apply(globalOf(input.project), projectLabel);
  apply(input.project.agents?.[input.agentId], `${projectLabel} (${input.agentId})`);

  apply(
    {
      provider: input.env.ANYAGENT_PROVIDER,
      model: input.env.ANYAGENT_MODEL,
      smallModel: input.env.ANYAGENT_SMALL_MODEL,
    },
    'environment',
  );

  apply(
    {
      provider: input.flags.provider,
      model: input.flags.model,
      smallModel: input.flags.smallModel,
    },
    'command line',
  );

  return result;
}

function globalOf(config: UserConfig): AgentDefaults {
  return {
    provider: config.provider,
    model: config.model,
    smallModel: config.smallModel,
    args: config.args,
  };
}

/** Read a dotted path such as `agents.claude.model`. */
export function getConfigValue(config: UserConfig, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, config);
}

/**
 * Write a dotted path. `claude.model` is accepted as shorthand for
 * `agents.claude.model` when `claude` is a known agent id.
 */
export function setConfigValue(
  config: UserConfig,
  key: string,
  value: string | undefined,
  knownAgents: readonly string[] = [],
): UserConfig {
  // Cloned so callers can compare before and after, and so a failed write
  // never leaves a half-updated object behind.
  const parts = key.split('.');
  if (parts.length > 1 && knownAgents.includes(parts[0]!) && parts[0] !== 'agents') {
    parts.unshift('agents');
  }

  const next = structuredClone(config) as UserConfig & Record<string, unknown>;
  let node = next;
  for (const part of parts.slice(0, -1)) {
    const existing = node[part];
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  const leaf = parts.at(-1)!;
  if (value === undefined) delete node[leaf];
  else node[leaf] = coerce(value);
  return next;
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
