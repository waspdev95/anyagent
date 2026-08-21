import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext } from '../types.js';

/**
 * Agents that are configured purely through environment variables.
 *
 * They share a shape but not a vocabulary - each vendor picked different
 * variable names for the same three ideas (endpoint, credential, model) - so
 * the differences are declared as data instead of repeated as code.
 */

interface EnvAgentSpec {
  id: string;
  name: string;
  description: string;
  homepage: string;
  aliases?: string[];
  bin: string[];
  wires: Agent['wires'];
  install: Agent['install'];
  extraPaths?: Agent['extraPaths'];
  /** Variable names for base URL, API key and model. */
  vars: { baseUrl: string; apiKey: string; model?: string };
  /** Additional fixed variables. */
  extraEnv?: Record<string, string>;
  /** How the model is passed on the command line, if at all. */
  modelFlag?: string;
  notes?: string[];
}

function envAgent(spec: EnvAgentSpec): Agent {
  const agent: Agent = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    homepage: spec.homepage,
    wires: spec.wires,
    bin: spec.bin,
    install: spec.install,
    plan(ctx: PlanContext): LaunchPlan {
      const { target } = ctx;
      const env: Record<string, string> = {
        [spec.vars.baseUrl]: target.baseUrl,
        [spec.vars.apiKey]: target.apiKey,
        ...spec.extraEnv,
      };
      if (spec.vars.model) env[spec.vars.model] = target.model.id;

      const args = spec.modelFlag
        ? [spec.modelFlag, target.model.id, ...ctx.passthrough]
        : [...ctx.passthrough];

      return {
        command: { file: spec.bin[0]!, args },
        env,
        files: [],
        notes: spec.notes ?? [],
      };
    },
  };
  if (spec.aliases) agent.aliases = spec.aliases;
  if (spec.extraPaths) agent.extraPaths = spec.extraPaths;
  return agent;
}

/**
 * GitHub Copilot CLI.
 *
 * Copilot reads a "bring your own provider" trio of variables. Its wire API is
 * selectable, and `responses` is what the current CLI expects from a custom
 * endpoint.
 */
export const copilot = envAgent({
  id: 'copilot',
  name: 'Copilot CLI',
  description: "GitHub's coding agent for the terminal",
  aliases: ['copilot-cli'],
  homepage: 'https://github.com/features/copilot/cli',
  wires: ['openai-responses'],
  bin: ['copilot'],
  install: {
    command: ['npm', 'install', '-g', '@github/copilot'],
    url: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  extraPaths: (home) => [path.join(home, '.local', 'bin')],
  vars: {
    baseUrl: 'COPILOT_PROVIDER_BASE_URL',
    apiKey: 'COPILOT_PROVIDER_API_KEY',
    model: 'COPILOT_MODEL',
  },
  extraEnv: { COPILOT_PROVIDER_WIRE_API: 'responses' },
  modelFlag: '--model',
});

/**
 * Qwen Code.
 *
 * A Gemini CLI fork that talks to any OpenAI-compatible endpoint through the
 * standard OPENAI_* variables.
 */
export const qwen = envAgent({
  id: 'qwen',
  name: 'Qwen Code',
  description: "Alibaba's coding agent, forked from Gemini CLI",
  aliases: ['qwen-code'],
  homepage: 'https://qwenlm.github.io/qwen-code-docs/',
  wires: ['openai-chat'],
  bin: ['qwen'],
  install: {
    command: ['npm', 'install', '-g', '@qwen-code/qwen-code'],
    url: 'https://github.com/QwenLM/qwen-code',
  },
  vars: {
    baseUrl: 'OPENAI_BASE_URL',
    apiKey: 'OPENAI_API_KEY',
    model: 'OPENAI_MODEL',
  },
  notes: ['OPENAI_* variables are set for this process only.'],
});

/**
 * Poolside's `pool` CLI, in standalone mode.
 */
export const pool = envAgent({
  id: 'pool',
  name: 'Pool',
  description: "Poolside's software agent",
  aliases: ['poolside'],
  homepage: 'https://github.com/poolsideai/pool',
  wires: ['openai-chat'],
  bin: ['pool'],
  install: { url: 'https://github.com/poolsideai/pool' },
  vars: {
    baseUrl: 'POOLSIDE_STANDALONE_BASE_URL',
    apiKey: 'POOLSIDE_API_KEY',
  },
  modelFlag: '-m',
});

export const ENV_AGENTS: Agent[] = [copilot, qwen, pool];
