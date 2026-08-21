/**
 * `anyagent auth` - managing API keys.
 *
 * Keys are only ever printed masked, and `auth test` performs the smallest
 * possible authenticated request so a bad key is caught here rather than three
 * screens into an agent session.
 */

import { parseArgs, type FlagSpecs } from '../args.js';
import type { Cli } from '../context.js';
import { envVarNameFor, keyLooksWrong, resolveKey } from '../credentials.js';
import { AnyAgentError, maskKey } from '../errors.js';
import { text } from '../prompt.js';
import { resolveProvider } from '../resolve.js';
import type { Provider, Wire } from '../types.js';
import {
  color,
  failure,
  heading,
  json as printJson,
  note,
  out,
  printTable,
  success,
  symbols,
} from '../ui.js';

const AUTH_FLAGS: FlagSpecs = {
  key: { type: 'string', value: '<key>', description: 'Key value, instead of a prompt' },
  store: {
    type: 'string',
    value: '<file|keychain>',
    description: 'Where to keep the key for this call',
  },
};

export async function authCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, AUTH_FLAGS, { maxPositionals: 2 });
  const [subcommand = 'list', providerId] = parsed.positionals;

  switch (subcommand) {
    case 'add':
    case 'set':
      return add(
        cli,
        providerId,
        typeof parsed.flags.key === 'string' ? parsed.flags.key : undefined,
      );
    case 'list':
    case 'ls':
      return list(cli);
    case 'rm':
    case 'remove':
    case 'delete':
      return remove(cli, providerId);
    case 'test':
      return test(cli, providerId);
    default:
      throw new AnyAgentError(`Unknown auth command "${subcommand}".`, {
        hint: 'Use: anyagent auth <add|list|rm|test> [provider]',
      });
  }
}

async function add(
  cli: Cli,
  providerId: string | undefined,
  key: string | undefined,
): Promise<number> {
  if (!providerId) {
    throw new AnyAgentError('Which provider?', { hint: 'anyagent auth add openrouter' });
  }
  const catalog = await cli.catalog();
  const provider = resolveProvider(catalog, providerId);

  if (provider.keyless) {
    note(`${provider.name} runs locally and needs no key.`);
    return 0;
  }

  out();
  if (provider.console) note(`Create a key at ${provider.console}`);
  const value = key ?? (await text(`  ${provider.name} API key:`, { mask: true }));
  if (!value) throw new AnyAgentError('No key entered.');

  const problem = keyLooksWrong(provider, value);
  if (problem) note(color.yellow(problem));

  await cli.store.set(provider.id, value);
  success(`Saved ${provider.name} key (${maskKey(value)}) to ${cli.store.location()}`);
  note(`Use it now: anyagent claude --provider ${provider.id}`);
  return 0;
}

async function list(cli: Cli): Promise<number> {
  const catalog = await cli.catalog();
  const stored = await cli.store.list();

  const rows = await Promise.all(
    catalog.providers
      .filter((provider) => stored.includes(provider.id) || hasEnvKey(provider, cli.env))
      .map(async (provider) => {
        const source = await resolveKey(provider, cli.store, cli.env);
        return {
          provider: provider.id,
          origin: source?.origin ?? 'none',
          key: source ? maskKey(source.key) : '-',
        };
      }),
  );

  if (cli.json) {
    printJson(rows);
    return 0;
  }

  heading('  Saved credentials');
  out();
  if (rows.length === 0) {
    note('None yet. Add one with `anyagent auth add openrouter`.');
    out();
    return 0;
  }
  printTable(
    [{ header: 'provider' }, { header: 'key' }, { header: 'source' }],
    rows.map((row) => [row.provider, color.dim(row.key), color.dim(row.origin)]),
  );
  out();
  note(`Store: ${cli.store.location()}`);
  out();
  return 0;
}

function hasEnvKey(provider: Provider, env: NodeJS.ProcessEnv): boolean {
  if (env[envVarNameFor(provider.id)]) return true;
  return provider.env.some((name) => Boolean(env[name]));
}

async function remove(cli: Cli, providerId: string | undefined): Promise<number> {
  if (!providerId)
    throw new AnyAgentError('Which provider?', { hint: 'anyagent auth rm openrouter' });
  const removed = await cli.store.delete(providerId);
  if (!removed) {
    failure(`No stored key for "${providerId}".`);
    return 1;
  }
  success(`Removed the ${providerId} key.`);
  return 0;
}

/**
 * Verify a key with one cheap request.
 *
 * OpenAI-compatible endpoints answer `GET /models`; Anthropic-compatible ones
 * have no such route, so a deliberately malformed Messages call is used - a 401
 * still means "bad key" and anything else means the credential was accepted.
 */
async function test(cli: Cli, providerId: string | undefined): Promise<number> {
  const catalog = await cli.catalog();
  const provider = resolveProvider(catalog, providerId ?? cli.config.provider);
  const source = await resolveKey(provider, cli.store, cli.env);
  if (!source) {
    failure(`No key configured for ${provider.name}.`);
    note(`Add one with: anyagent auth add ${provider.id}`);
    return 1;
  }

  const wire: Wire = provider.baseUrl['openai-chat']
    ? 'openai-chat'
    : provider.baseUrl['openai-responses']
      ? 'openai-responses'
      : 'anthropic';
  const base = provider.baseUrl[wire]!;

  out();
  note(`${provider.name}  ${base}  key from ${source.origin}`);

  try {
    const response =
      wire === 'anthropic'
        ? await fetch(`${base}/v1/messages`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'anthropic-version': '2023-06-01',
              'x-api-key': source.key,
              authorization: `Bearer ${source.key}`,
              ...provider.headers,
            },
            body: JSON.stringify({ model: 'ping', max_tokens: 1, messages: [] }),
          })
        : await fetch(`${base}/models`, {
            headers: { authorization: `Bearer ${source.key}`, ...provider.headers },
          });

    if (response.status === 401 || response.status === 403) {
      failure(`${provider.name} rejected the key (HTTP ${response.status}).`);
      return 1;
    }
    success(`${provider.name} accepted the key (HTTP ${response.status}).`);
    return 0;
  } catch (error) {
    failure(`Could not reach ${base}: ${(error as Error).message}`);
    note(`${symbols.bullet} Check your network, proxy settings, or --base-url.`);
    return 1;
  }
}
