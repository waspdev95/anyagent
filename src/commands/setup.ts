/**
 * The interactive parts of a launch: choosing a provider, storing a key,
 * choosing a model, installing a missing agent.
 *
 * Each of these runs at most once. The result is written to the config or the
 * credential store immediately, so the second launch of the same agent is a
 * single word with no questions.
 */

import type { Catalog } from '../catalog.js';
import { saveUserConfig } from '../config.js';
import type { Cli } from '../context.js';
import { keyLooksWrong, type CredentialSource } from '../credentials.js';
import { AnyAgentError } from '../errors.js';
import { buildCommand, run, which } from '../exec.js';
import { confirm, isInteractive, select, text } from '../prompt.js';
import { negotiateWire, incompatible, resolveProvider } from '../resolve.js';
import { locate } from '../runner.js';
import type { Agent, Model, Provider } from '../types.js';
import { color, formatCost, formatTokens, out, success } from '../ui.js';

/**
 * Providers shown at the top of the picker.
 *
 * Ordering by "what a newcomer is most likely to want" beats alphabetical here:
 * the list is 190 entries long and the first screen decides whether the tool
 * feels helpful or overwhelming.
 */
const SUGGESTED = [
  'openrouter',
  'deepseek',
  'zai',
  'moonshotai',
  'groq',
  'cerebras',
  'togetherai',
  'fireworks-ai',
  'xai',
  'openai',
  'anthropic',
  'mistral',
  'ollama',
];

export async function chooseProvider(
  cli: Cli,
  catalog: Catalog,
  agent: Agent,
  preferred: string | undefined,
): Promise<Provider> {
  if (preferred) {
    const provider = resolveProvider(catalog, preferred);
    if (!negotiateWire(agent, provider)) throw incompatible(agent, provider, catalog);
    return provider;
  }

  const compatible = catalog.providers.filter((provider) => negotiateWire(agent, provider));
  if (compatible.length === 0) {
    throw new AnyAgentError(`No known provider can drive ${agent.name}.`);
  }

  if (!isInteractive()) {
    throw new AnyAgentError('No provider selected.', {
      hint: `Pass --provider <id>, or set one with \`anyagent use <provider>/<model>\`.\nProviders for ${agent.name}: ${compatible
        .slice(0, 8)
        .map((provider) => provider.id)
        .join(', ')}`,
    });
  }

  const configured = new Set(await cli.store.list());
  const ranked = [...compatible].sort((a, b) => rank(a, configured) - rank(b, configured));

  out();
  const id = await select(
    `  Which provider should ${agent.name} use?`,
    ranked.map((provider) => ({
      value: provider.id,
      label: provider.id,
      detail: [
        provider.name,
        configured.has(provider.id) ? color.green('key saved') : undefined,
        provider.local ? color.dim('local') : undefined,
      ]
        .filter(Boolean)
        .join('  '),
      keywords: provider.name,
    })),
  );

  const provider = resolveProvider(catalog, id);
  cli.config.provider = provider.id;
  await saveUserConfig(cli.paths.config, cli.config);
  return provider;
}

function rank(provider: Provider, configured: Set<string>): number {
  if (configured.has(provider.id)) return -1000;
  const index = SUGGESTED.indexOf(provider.id);
  return index === -1 ? 1000 : index;
}

export async function promptForKey(cli: Cli, provider: Provider): Promise<CredentialSource> {
  if (provider.keyless) {
    return { key: 'anyagent', origin: 'not required (local provider)', ephemeral: true };
  }

  if (!isInteractive()) {
    throw new AnyAgentError(`No API key for ${provider.name}.`, {
      hint:
        `Set ${provider.env[0] ?? `ANYAGENT_${provider.id.toUpperCase()}_API_KEY`} in the environment, ` +
        `or run \`anyagent auth add ${provider.id}\`.`,
    });
  }

  out();
  out(`  ${color.bold(provider.name)} needs an API key.`);
  if (provider.console) out(color.dim(`  Create one at ${provider.console}`));
  out();

  const key = await text('  Paste your API key:', { mask: true });
  if (!key) throw new AnyAgentError('No key entered.');

  const problem = keyLooksWrong(provider, key);
  if (problem && !(await confirm(`  ${problem} Use it anyway?`, false))) {
    throw new AnyAgentError('Key rejected.');
  }

  await cli.store.set(provider.id, key);
  success(`Key saved to ${cli.store.location()}`);
  return { key, origin: cli.store.location(), ephemeral: false };
}

export async function chooseModel(
  cli: Cli,
  catalog: Catalog,
  provider: Provider,
  preferred: string | undefined,
): Promise<string> {
  if (preferred) return preferred;

  const models = catalog.models.get(provider.id) ?? [];
  if (models.length === 0) {
    if (!isInteractive()) {
      throw new AnyAgentError(`No model selected for ${provider.name}.`, {
        hint: 'Pass --model <id>.',
      });
    }
    return text(`  Model id for ${provider.name}:`);
  }

  if (!isInteractive()) {
    throw new AnyAgentError(`No model selected for ${provider.name}.`, {
      hint: `Pass --model <id>, or run \`anyagent models --provider ${provider.id}\` to browse.`,
    });
  }

  out();
  const id = await select(
    `  Which ${provider.name} model?`,
    [...models].sort(byUsefulness).map((model) => ({
      value: model.id,
      label: model.id,
      detail: modelDetail(model),
      keywords: model.name,
    })),
  );

  cli.config.model = id;
  cli.config.provider = provider.id;
  await saveUserConfig(cli.paths.config, cli.config);
  return id;
}

/** Tool-capable models first, then larger context, then cheaper. */
function byUsefulness(a: Model, b: Model): number {
  if (a.toolCall !== b.toolCall) return a.toolCall ? -1 : 1;
  const context = (b.contextLimit ?? 0) - (a.contextLimit ?? 0);
  if (context !== 0) return context;
  return (a.cost?.input ?? 0) - (b.cost?.input ?? 0);
}

function modelDetail(model: Model): string {
  const parts = [formatTokens(model.contextLimit)];
  if (model.cost?.input !== undefined) parts.push(`in ${formatCost(model.cost.input)}/M`);
  if (model.cost?.output !== undefined) parts.push(`out ${formatCost(model.cost.output)}/M`);
  if (!model.toolCall) parts.push(color.yellow('no tools'));
  return parts.join('  ');
}

/**
 * Offer to install a missing agent.
 *
 * Only ever runs the vendor's own documented install command, and only after an
 * explicit yes - a launcher that installs software unattended is a launcher
 * nobody should trust.
 */
export async function installAgent(cli: Cli, agent: Agent): Promise<string | undefined> {
  const command = agent.install.command;
  if (!command || !isInteractive()) return undefined;

  out();
  out(`  ${agent.name} is not installed.`);
  out(color.dim(`  Install command: ${command.join(' ')}`));
  if (!(await confirm('  Install it now?', true))) return undefined;

  const [file, ...args] = command;
  const binary = which(file!, { platform: cli.platform });
  if (!binary) {
    throw new AnyAgentError(`Cannot run "${file}" - it is not on PATH.`, {
      hint: `Install ${agent.name} manually: ${agent.install.url}`,
    });
  }

  const result = await run(buildCommand(binary, args, cli.platform), {
    env: cli.env,
    cwd: cli.cwd,
    platform: cli.platform,
  });
  if (result.code !== 0) {
    throw new AnyAgentError(`Installing ${agent.name} failed with exit code ${result.code}.`, {
      hint: `Install it manually: ${agent.install.url}`,
    });
  }

  const located = locate(agent, cli.home, cli.platform);
  if (!located) {
    throw new AnyAgentError(`${agent.name} was installed but is not on PATH yet.`, {
      hint: 'Open a new terminal and try again.',
    });
  }
  success(`${agent.name} installed.`);
  return located;
}
