/**
 * `anyagent model` and `anyagent key` - the two things a newcomer needs, named
 * after what they do rather than after the machinery behind them.
 *
 * Both are thin: `model` is `use` with a picker when you give it nothing, and
 * `key` is `auth` with a sensible default subcommand. The longer forms still
 * exist for scripts.
 */

import { parseArgs } from '../args.js';
import { findProvider, type Catalog } from '../catalog.js';
import { saveUserConfig } from '../config.js';
import type { Cli } from '../context.js';
import { AnyAgentError } from '../errors.js';
import { resolveModel } from '../resolve.js';
import { note, out, success } from '../ui.js';
import { authCommand } from './auth.js';
import { chooseModel, chooseProvider } from './setup.js';

/**
 * `anyagent model` - show or change the model everything uses.
 *
 *   anyagent model                          pick from a list
 *   anyagent model deepseek/deepseek-chat   set it directly
 *   anyagent model --agent codex            change it for one tool only
 */
export async function modelCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(
    argv,
    {
      agent: { type: 'string', short: 'a', value: '<id>', description: 'Change one agent only' },
      provider: { type: 'string', value: '<id>', description: 'Provider to pick from' },
    },
    { maxPositionals: 1 },
  );

  const wanted = parsed.positionals[0];
  const agentId = typeof parsed.flags.agent === 'string' ? parsed.flags.agent : undefined;
  const catalog = await cli.catalog();
  const providerFlag =
    typeof parsed.flags.provider === 'string' ? parsed.flags.provider : undefined;
  const providerId = providerFlag ?? cli.config.provider;

  if (wanted) {
    const resolved = resolveSpec(catalog, wanted, providerId);
    return apply(cli, resolved.provider, resolved.model, agentId);
  }

  const provider = await chooseProvider(cli, catalog, undefined, providerId);
  const model = await chooseModel(cli, catalog, provider, undefined);
  return apply(cli, provider.id, model, agentId);
}

/**
 * Work out what `anyagent model <thing>` meant.
 *
 * The argument is a *model id*, and model ids contain slashes -
 * `deepseek/deepseek-chat` is one model on OpenRouter, not the model
 * `deepseek-chat` on a provider called `deepseek`. So the current provider is
 * tried first, and only if the id means nothing there is the leading segment
 * considered as a provider name.
 */
function resolveSpec(
  catalog: Catalog,
  wanted: string,
  providerId: string | undefined,
): { provider: string; model: string } {
  if (providerId) {
    const provider = findProvider(catalog, providerId);
    if (provider) {
      try {
        return { provider: provider.id, model: resolveModel(catalog, provider, wanted).id };
      } catch (error) {
        const slash = wanted.indexOf('/');
        const prefix = slash > 0 ? findProvider(catalog, wanted.slice(0, slash)) : undefined;
        if (!prefix) throw error;
        return {
          provider: prefix.id,
          model: resolveModel(catalog, prefix, wanted.slice(slash + 1)).id,
        };
      }
    }
  }

  // No provider configured yet: the id has to carry one.
  const slash = wanted.indexOf('/');
  const prefix = slash > 0 ? findProvider(catalog, wanted.slice(0, slash)) : undefined;
  if (!prefix) {
    throw new AnyAgentError('No provider chosen yet.', {
      hint: 'Run `anyagent model` to pick one from a list,\nor name it: anyagent model openrouter/deepseek/deepseek-chat',
    });
  }
  return { provider: prefix.id, model: resolveModel(catalog, prefix, wanted.slice(slash + 1)).id };
}

/** Save the choice, either globally or for one agent. */
async function apply(
  cli: Cli,
  providerId: string,
  model: string,
  agentId: string | undefined,
): Promise<number> {
  if (agentId) {
    const agents = { ...(cli.config.agents ?? {}) };
    agents[agentId] = { ...agents[agentId], provider: providerId, model };
    cli.config.agents = agents;
    await saveUserConfig(cli.paths.config, cli.config);
    success(`${agentId} will use ${providerId} / ${model}`);
    return 0;
  }

  cli.config.provider = providerId;
  cli.config.model = model;
  await saveUserConfig(cli.paths.config, cli.config);

  success(`Now using ${providerId} / ${model}`);
  out();
  note('Run an agent with it:  anyagent claude');
  out();
  return 0;
}

/**
 * `anyagent key [provider]` - save an API key.
 *
 * With no provider it lists what is already saved, which is the question people
 * actually have ("did I already do this?").
 */
export async function keyCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(
    argv,
    { key: { type: 'string', value: '<key>', description: 'The key, instead of a prompt' } },
    { maxPositionals: 1, forwardUnknown: true },
  );

  const provider = parsed.positionals[0];
  if (!provider) return authCommand(cli, ['list']);

  const args = ['add', provider];
  if (typeof parsed.flags.key === 'string') args.push('--key', parsed.flags.key);
  return authCommand(cli, args);
}
