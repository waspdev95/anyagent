/**
 * `anyagent config` and `anyagent use` - defaults, so nothing has to be typed
 * twice.
 */

import { parseArgs } from '../args.js';
import { agentIds } from '../agents/index.js';
import { getConfigValue, saveUserConfig, setConfigValue } from '../config.js';
import type { Cli } from '../context.js';
import { AnyAgentError } from '../errors.js';
import { resolveModel, resolveProvider, splitQualifiedModel } from '../resolve.js';
import { color, heading, json as printJson, note, out, success } from '../ui.js';

export async function configCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {}, { maxPositionals: 3 });
  const [subcommand = 'list', key, value] = parsed.positionals;

  switch (subcommand) {
    case 'list':
    case 'ls':
      if (cli.json) {
        printJson({ user: cli.config, project: cli.project.config, file: cli.paths.config });
        return 0;
      }
      heading('  Configuration');
      out();
      out(color.dim(`  ${cli.paths.config}`));
      out(indent(JSON.stringify(cli.config, null, 2)));
      if (cli.project.file) {
        out();
        out(color.dim(`  ${cli.project.file}`));
        out(indent(JSON.stringify(cli.project.config, null, 2)));
      }
      out();
      return 0;

    case 'get': {
      if (!key) throw new AnyAgentError('Which key?', { hint: 'anyagent config get model' });
      const found = getConfigValue(cli.config, key);
      if (found === undefined) {
        note(`${key} is not set.`);
        return 1;
      }
      out(typeof found === 'string' ? found : JSON.stringify(found));
      return 0;
    }

    case 'set': {
      if (!key) {
        throw new AnyAgentError('Which key?', {
          hint: 'anyagent config set model deepseek/deepseek-chat\nanyagent config set claude.provider openrouter',
        });
      }
      if (value === undefined) throw new AnyAgentError(`No value given for "${key}".`);
      const updated = setConfigValue(cli.config, key, value, agentIds());
      await saveUserConfig(cli.paths.config, updated);
      success(`${key} = ${value}`);
      return 0;
    }

    case 'unset':
    case 'rm': {
      if (!key) throw new AnyAgentError('Which key?', { hint: 'anyagent config unset model' });
      const updated = setConfigValue(cli.config, key, undefined, agentIds());
      await saveUserConfig(cli.paths.config, updated);
      success(`${key} removed.`);
      return 0;
    }

    case 'path':
      out(cli.paths.config);
      return 0;

    default:
      throw new AnyAgentError(`Unknown config command "${subcommand}".`, {
        hint: 'Use: anyagent config <list|get|set|unset|path>',
      });
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

const USE_FLAGS = {
  agent: {
    type: 'string' as const,
    short: 'a',
    value: '<id>',
    description: 'Set the default for one agent only',
  },
};

/**
 * `anyagent use <provider>[/<model>]`
 *
 * The shorthand people reach for. Both halves are validated against the catalog
 * before anything is written, so a typo is caught now rather than at launch.
 */
export async function useCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, USE_FLAGS, { maxPositionals: 1 });
  const spec = parsed.positionals[0];
  if (!spec) {
    throw new AnyAgentError('What should be the default?', {
      hint: 'anyagent use openrouter/deepseek/deepseek-chat\nanyagent use groq',
    });
  }

  const catalog = await cli.catalog();
  const separator = spec.indexOf('/');
  const providerPart = separator === -1 ? spec : spec.slice(0, separator);
  const modelPart = separator === -1 ? undefined : spec.slice(separator + 1);

  const provider = resolveProvider(catalog, providerPart);
  const qualified = modelPart ? splitQualifiedModel(catalog, modelPart, provider) : undefined;
  const model = qualified ? resolveModel(catalog, provider, qualified.model) : undefined;

  const agentId = typeof parsed.flags.agent === 'string' ? parsed.flags.agent : undefined;
  if (agentId && !agentIds().includes(agentId)) {
    throw new AnyAgentError(`Unknown agent "${agentId}".`, { hint: 'Run `anyagent ls`.' });
  }

  let config = cli.config;
  if (agentId) {
    config = setConfigValue(config, `agents.${agentId}.provider`, provider.id);
    if (model) config = setConfigValue(config, `agents.${agentId}.model`, model.id);
  } else {
    config = setConfigValue(config, 'provider', provider.id);
    if (model) config = setConfigValue(config, 'model', model.id);
  }

  await saveUserConfig(cli.paths.config, config);
  success(
    `Default${agentId ? ` for ${agentId}` : ''}: ${provider.id}${model ? `/${model.id}` : ''}`,
  );
  if (!model) note('No model set yet - pass --model or run `anyagent models` to pick one.');
  return 0;
}
