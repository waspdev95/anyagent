/**
 * `anyagent exec` and `anyagent env` - the escape hatch.
 *
 * Not every tool will ever have a first-class integration, and waiting for one
 * is a bad reason to be stuck. These two commands expose the same resolved
 * provider, key and model as standard environment variables, so anything that
 * reads `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL` works immediately:
 *
 *   anyagent exec -- aider --model deepseek/deepseek-chat
 *   eval "$(anyagent env --provider groq)"
 */

import { parseArgs, type FlagSpecs } from '../args.js';
import type { Cli } from '../context.js';
import { resolveKey } from '../credentials.js';
import { AnyAgentError } from '../errors.js';
import { buildCommand, run, which } from '../exec.js';
import { commonBinPaths } from '../exec.js';
import { normalizeBase } from '../catalog.js';
import { resolveModel, resolveProvider } from '../resolve.js';
import type { Provider, Target } from '../types.js';
import { json as printJson, out } from '../ui.js';
import { promptForKey } from './setup.js';

const EXEC_FLAGS: FlagSpecs = {
  model: { type: 'string', short: 'm', value: '<id>', description: 'Model id' },
  provider: { type: 'string', short: 'p', value: '<id>', description: 'Provider id' },
  'base-url': { type: 'string', value: '<url>', description: 'Override the endpoint' },
  'api-key': { type: 'string', value: '<key>', description: 'Use this key once' },
};

/** Resolve provider/model/key without tying the result to a specific agent. */
async function resolveGeneric(
  cli: Cli,
  flags: Record<string, string | boolean | undefined>,
): Promise<Target> {
  const catalog = await cli.catalog();
  const providerId =
    str(flags.provider) ??
    cli.project.config.provider ??
    cli.config.provider ??
    cli.env.ANYAGENT_PROVIDER;
  const provider = resolveProvider(catalog, providerId);

  const credential =
    (await resolveKey(provider, cli.store, cli.env, str(flags['api-key']))) ??
    (await promptForKey(cli, provider));

  const modelId =
    str(flags.model) ?? cli.project.config.model ?? cli.config.model ?? cli.env.ANYAGENT_MODEL;
  const model = resolveModel(catalog, provider, modelId);

  const wire = provider.baseUrl['openai-chat']
    ? 'openai-chat'
    : provider.baseUrl['openai-responses']
      ? 'openai-responses'
      : 'anthropic';

  const override = str(flags['base-url']);
  return {
    provider,
    wire,
    baseUrl: override ? normalizeBase(override) : provider.baseUrl[wire]!,
    apiKey: credential.key,
    model,
  };
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Variables that cover the conventions in common use.
 *
 * Both families are exported because tools disagree about which one they read,
 * and the Anthropic pair is only set when the provider actually serves that
 * protocol - pointing `ANTHROPIC_BASE_URL` at a chat-completions endpoint would
 * fail in a far more confusing way than not setting it at all.
 */
export function genericEnv(target: Target): Record<string, string> {
  const env: Record<string, string> = {
    OPENAI_BASE_URL: target.baseUrl,
    OPENAI_API_KEY: target.apiKey,
    OPENAI_MODEL: target.model.id,
    ANYAGENT_PROVIDER: target.provider.id,
    ANYAGENT_MODEL: target.model.id,
  };

  const anthropicBase = target.provider.baseUrl.anthropic;
  if (anthropicBase) {
    env.ANTHROPIC_BASE_URL = anthropicBase;
    env.ANTHROPIC_API_KEY = target.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = target.apiKey;
    env.ANTHROPIC_MODEL = target.model.id;
  }

  for (const name of providerEnvNames(target.provider)) env[name] = target.apiKey;
  return env;
}

/** The provider's own key variable, so vendor SDKs pick it up unchanged. */
function providerEnvNames(provider: Provider): string[] {
  return provider.env.filter((name) => name.endsWith('_API_KEY'));
}

/** `anyagent exec -- <command>` */
export async function execCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, EXEC_FLAGS, { forwardUnknown: true, maxPositionals: 0 });
  const command = [...parsed.positionals, ...parsed.passthrough];
  if (command.length === 0) {
    throw new AnyAgentError('Nothing to run.', {
      hint: 'anyagent exec -- aider --model deepseek/deepseek-chat',
    });
  }

  const target = await resolveGeneric(cli, parsed.flags);
  const [file, ...args] = command;
  const binary = which(file!, {
    platform: cli.platform,
    env: cli.env,
    extraPaths: commonBinPaths(cli.home, cli.platform),
  });
  if (!binary) {
    throw new AnyAgentError(`"${file}" is not on PATH.`, { exitCode: 127 });
  }

  const result = await run(buildCommand(binary, args, cli.platform), {
    env: { ...cli.env, ...genericEnv(target) },
    cwd: cli.cwd,
    platform: cli.platform,
  });
  return result.code;
}

const ENV_FLAGS: FlagSpecs = {
  ...EXEC_FLAGS,
  shell: {
    type: 'string',
    value: '<posix|powershell|cmd>',
    description: 'Output syntax (default: match the current platform)',
  },
};

/** `anyagent env` - print the variables for `eval`. */
export async function envCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, ENV_FLAGS, { maxPositionals: 0 });
  const target = await resolveGeneric(cli, parsed.flags);
  const env = genericEnv(target);

  if (cli.json) {
    printJson(env);
    return 0;
  }

  const shell = str(parsed.flags.shell) ?? (cli.platform === 'win32' ? 'powershell' : 'posix');
  for (const [name, value] of Object.entries(env)) out(formatEnv(shell, name, value));
  return 0;
}

export function formatEnv(shell: string, name: string, value: string): string {
  switch (shell) {
    case 'powershell':
    case 'pwsh':
      return `$env:${name} = ${JSON.stringify(value)}`;
    case 'cmd':
      return `set ${name}=${value}`;
    case 'fish':
      return `set -gx ${name} ${quotePosix(value)}`;
    default:
      return `export ${name}=${quotePosix(value)}`;
  }
}

/** Single-quote for POSIX shells, escaping embedded quotes the usual way. */
function quotePosix(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}
