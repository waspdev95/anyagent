/**
 * Browsing commands: what can I run, where can I run it, and what will talk to
 * what. All of them support `--json` so they compose with other tools.
 */

import { parseArgs, type FlagSpecs } from '../args.js';
import { AGENTS } from '../agents/index.js';
import type { Catalog } from '../catalog.js';
import { resolveDefaults } from '../config.js';
import type { Cli } from '../context.js';
import { byPopularity } from '../popular.js';
import { negotiateWire, WIRE_LABELS } from '../resolve.js';
import { detectVersion, locate } from '../runner.js';
import type { Wire } from '../types.js';
import {
  color,
  formatCost,
  formatTokens,
  heading,
  json as printJson,
  note,
  out,
  printTable,
  symbols,
} from '../ui.js';

export const LS_FLAGS: FlagSpecs = {
  installed: {
    type: 'boolean',
    short: 'i',
    description: 'Only agents that are already installed',
  },
  versions: { type: 'boolean', description: 'Query each installed agent for its version' },
};

/** `anyagent ls` - agents, whether they are installed, and what they can use. */
export async function lsCommand(cli: Cli, argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, LS_FLAGS);
  const catalog = await cli.catalog();

  const rows = await Promise.all(
    AGENTS.map(async (agent) => {
      const binary = locate(agent, cli.home, cli.platform);
      const version =
        binary && flags.versions === true
          ? await detectVersion(agent, binary, cli.paths.versionCache)
          : undefined;
      const providers = catalog.providers.filter((provider) => negotiateWire(agent, provider));
      const defaults = resolveDefaults({
        agentId: agent.id,
        user: cli.config,
        project: cli.project.config,
        env: cli.env,
        flags: {},
      });
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        installed: Boolean(binary),
        path: binary,
        version,
        model: defaults.model,
        provider: defaults.provider,
        protocols: agent.wires,
        providerCount: providers.length,
      };
    }),
  );

  // Everything is listed by default: the list is short, and seeing what else
  // exists is most of the point.
  const visible = flags.installed === true ? rows.filter((row) => row.installed) : rows;

  if (cli.json) {
    printJson(visible);
    return 0;
  }

  heading('  Agents');
  out();
  printTable(
    [{ header: 'agent' }, { header: 'status' }, { header: 'runs on' }, { header: 'what it is' }],
    visible.map((row) => [
      row.installed ? color.bold(row.id) : color.dim(row.id),
      row.installed
        ? color.green(`${symbols.ok} ready${row.version ? ` ${row.version}` : ''}`)
        : color.dim('not installed'),
      row.installed ? (row.model ?? color.yellow('no model set')) : color.dim('-'),
      color.dim(row.description),
    ]),
  );
  out();
  note('anyagent <agent>       run it');
  note('anyagent model         change the model');
  out();
  return 0;
}

export const PROVIDERS_FLAGS: FlagSpecs = {
  wire: { type: 'string', value: '<protocol>', description: 'Filter by protocol' },
  agent: {
    type: 'string',
    short: 'a',
    value: '<id>',
    description: 'Only providers this agent can use',
  },
  configured: { type: 'boolean', description: 'Only providers with a saved key' },
  limit: { type: 'string', short: 'n', value: '<count>', description: 'Maximum rows (default 40)' },
};

/** `anyagent providers [query]` */
export async function providersCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, PROVIDERS_FLAGS);
  const query = parsed.positionals.join(' ').toLowerCase();
  const catalog = await cli.catalog();
  const configured = new Set(await cli.store.list());

  const agentId = typeof parsed.flags.agent === 'string' ? parsed.flags.agent : undefined;
  const agent = agentId ? AGENTS.find((candidate) => candidate.id === agentId) : undefined;
  const wire = typeof parsed.flags.wire === 'string' ? (parsed.flags.wire as Wire) : undefined;

  let providers = catalog.providers;
  if (query) {
    providers = providers.filter(
      (provider) =>
        provider.id.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query),
    );
  }
  if (wire) providers = providers.filter((provider) => Boolean(provider.baseUrl[wire]));
  if (agent) providers = providers.filter((provider) => negotiateWire(agent, provider));
  if (parsed.flags.configured === true) {
    providers = providers.filter((provider) => configured.has(provider.id) || provider.keyless);
  }

  if (cli.json) {
    printJson(
      providers.map((provider) => ({
        ...provider,
        models: catalog.models.get(provider.id)?.length ?? 0,
        keyConfigured: configured.has(provider.id),
      })),
    );
    return 0;
  }

  const limit = Number.parseInt(String(parsed.flags.limit ?? '40'), 10) || 40;
  const shown = byPopularity(providers, configured).slice(0, limit);

  heading(`  Providers${query ? ` matching "${query}"` : ''}`);
  out();
  printTable(
    [
      { header: 'provider' },
      { header: 'key' },
      { header: 'models', align: 'right' },
      { header: 'name' },
    ],
    shown.map((provider) => [
      provider.id,
      provider.keyless
        ? color.dim('local')
        : configured.has(provider.id)
          ? color.green(`${symbols.ok} saved`)
          : color.dim('-'),
      String(catalog.models.get(provider.id)?.length ?? 0),
      color.dim(provider.name),
    ]),
  );
  out();
  if (providers.length > shown.length) {
    note(`${providers.length - shown.length} more - narrow the search or pass -n <count>`);
  }
  note('anyagent key <provider>   save a key for one');
  out();
  return 0;
}

export const MODELS_FLAGS: FlagSpecs = {
  provider: { type: 'string', short: 'p', value: '<id>', description: 'Provider to search' },
  tools: { type: 'boolean', description: 'Only models with tool calling' },
  free: { type: 'boolean', description: 'Only models priced at zero' },
  limit: { type: 'string', short: 'n', value: '<count>', description: 'Maximum rows (default 30)' },
};

/** `anyagent models [query]` */
export async function modelsCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, MODELS_FLAGS);
  const query = parsed.positionals.join(' ').toLowerCase();
  const catalog = await cli.catalog();

  const providerId =
    (typeof parsed.flags.provider === 'string' ? parsed.flags.provider : undefined) ??
    cli.config.provider;

  const providers = providerId
    ? catalog.providers.filter((provider) => provider.id === providerId)
    : catalog.providers;

  const rows: { provider: string; id: string; model: ReturnType<typeof pick> }[] = [];
  for (const provider of providers) {
    for (const model of catalog.models.get(provider.id) ?? []) {
      if (query && !`${model.id} ${model.name}`.toLowerCase().includes(query)) continue;
      if (parsed.flags.tools === true && model.toolCall === false) continue;
      if (parsed.flags.free === true && (model.cost?.input ?? 1) !== 0) continue;
      rows.push({ provider: provider.id, id: model.id, model: pick(model) });
    }
  }

  if (cli.json) {
    printJson(rows);
    return 0;
  }

  const limit = Number.parseInt(String(parsed.flags.limit ?? '30'), 10) || 30;
  const shown = rows.slice(0, limit);

  heading(`  Models${query ? ` matching "${query}"` : ''}${providerId ? ` on ${providerId}` : ''}`);
  out();
  if (shown.length === 0) {
    note('No matches. Try a shorter query, or `anyagent update` to refresh the catalog.');
    out();
    return 1;
  }
  printTable(
    [
      { header: 'model' },
      ...(providerId ? [] : [{ header: 'provider' as const }]),
      { header: 'context', align: 'right' },
      { header: 'in/M', align: 'right' },
      { header: 'out/M', align: 'right' },
      { header: 'tools' },
    ],
    shown.map((row) => [
      row.id,
      ...(providerId ? [] : [color.dim(row.provider)]),
      formatTokens(row.model.context),
      formatCost(row.model.input),
      formatCost(row.model.output),
      row.model.tools ? color.green(symbols.ok) : color.dim('-'),
    ]),
  );
  out();
  if (rows.length > shown.length) note(`${rows.length - shown.length} more - refine the search`);
  note('anyagent model <id>   make one the default');
  out();
  return 0;
}

function pick(model: {
  contextLimit?: number;
  cost?: { input?: number; output?: number };
  toolCall?: boolean;
}) {
  return {
    context: model.contextLimit,
    input: model.cost?.input,
    output: model.cost?.output,
    tools: model.toolCall !== false,
  };
}

/** `anyagent compat [agent]` - which providers work with which agent. */
export async function compatCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    why: { type: 'boolean', description: 'Also show the API each side speaks' },
  });
  const catalog = await cli.catalog();
  const wanted = parsed.positionals[0];
  const agents = wanted ? AGENTS.filter((agent) => agent.id === wanted) : AGENTS;

  const featured = featuredProviders(catalog);

  if (cli.json) {
    printJson(
      agents.map((agent) => ({
        agent: agent.id,
        protocols: agent.wires,
        providers: catalog.providers
          .filter((provider) => negotiateWire(agent, provider))
          .map((provider) => provider.id),
      })),
    );
    return 0;
  }

  const why = parsed.flags.why === true;

  heading('  What works with what');
  out();
  printTable(
    [
      { header: 'agent' },
      ...(why ? [{ header: 'needs' }] : []),
      ...featured.map((provider) => ({ header: provider.id })),
    ],
    agents.map((agent) => [
      agent.id,
      ...(why ? [color.dim(agent.wires.map((wire) => WIRE_LABELS[wire]).join(', '))] : []),
      ...featured.map((provider) =>
        negotiateWire(agent, provider) ? color.green(symbols.ok) : color.dim(symbols.fail),
      ),
    ]),
  );
  out();
  note(`Showing ${featured.length} of ${catalog.providers.length} providers.`);
  note('anyagent providers --agent claude   every provider one agent can use');
  if (!why) note('anyagent compat --why               why some pairs do not work');
  out();
  return 0;
}

function featuredProviders(catalog: Catalog) {
  const featured = ['openrouter', 'deepseek', 'groq', 'openai', 'anthropic', 'ollama'];
  return featured
    .map((id) => catalog.providers.find((provider) => provider.id === id))
    .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider));
}
