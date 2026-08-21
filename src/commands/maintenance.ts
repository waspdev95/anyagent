/**
 * `doctor`, `restore` and `update` - the commands you reach for when something
 * is off, or when you want your machine back the way it was.
 */

import { parseArgs } from '../args.js';
import { AGENTS, findAgent } from '../agents/index.js';
import { CATALOG_MAX_AGE_MS } from '../catalog.js';
import type { Cli } from '../context.js';
import { FileStore, resolveKey } from '../credentials.js';
import { AnyAgentError, maskKey } from '../errors.js';
import { pathExists } from '../fsx.js';
import { VERSION } from '../version.js';
import { confirm, isInteractive } from '../prompt.js';
import { detectVersion, locate, pendingRestores, restoreAgent } from '../runner.js';
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
  warn,
} from '../ui.js';

/** `anyagent doctor` - one screen that explains the current state. */
export async function doctorCommand(cli: Cli, argv: string[]): Promise<number> {
  parseArgs(argv, {});
  const catalog = await cli.catalog();
  const stored = await cli.store.list();
  const pending = await pendingRestores(cli.paths);

  const agents = await Promise.all(
    AGENTS.map(async (agent) => {
      const binary = locate(agent, cli.home, cli.platform);
      return {
        id: agent.id,
        installed: Boolean(binary),
        path: binary,
        version: binary ? await detectVersion(agent, binary, cli.paths.versionCache) : undefined,
      };
    }),
  );

  const defaultProvider = cli.config.provider;
  const credential = defaultProvider
    ? await resolveKey(
        catalog.providers.find((provider) => provider.id === defaultProvider) ?? {
          id: defaultProvider,
          name: defaultProvider,
          env: [],
          baseUrl: {},
        },
        cli.store,
        cli.env,
      )
    : undefined;

  const catalogAge = Date.now() - Date.parse(catalog.generatedAt);
  const report = {
    version: VERSION,
    node: process.version,
    platform: `${cli.platform} ${process.arch}`,
    stateDir: cli.paths.state,
    configFile: cli.paths.config,
    projectConfig: cli.project.file,
    credentialStore: cli.store.location(),
    savedKeys: stored,
    defaults: {
      provider: cli.config.provider,
      model: cli.config.model,
      agents: cli.config.agents,
    },
    catalog: {
      origin: catalog.origin,
      generatedAt: catalog.generatedAt,
      providers: catalog.providers.length,
      stale: catalogAge > CATALOG_MAX_AGE_MS,
    },
    agents: agents.filter((agent) => agent.installed),
    pendingRestores: pending,
  };

  if (cli.json) {
    printJson(report);
    return 0;
  }

  heading('  anyagent doctor');
  out();
  printTable(
    [{ header: 'check' }, { header: 'value' }],
    [
      ['anyagent', VERSION],
      ['node', process.version],
      ['platform', `${cli.platform} ${process.arch}`],
      ['state', cli.paths.state],
      ['config', cli.paths.config],
      ...(cli.project.file ? [['project config', cli.project.file]] : []),
      ['credentials', cli.store.location()],
      [
        'catalog',
        `${catalog.providers.length} providers, ${catalog.origin}, ${describeAge(catalogAge)}`,
      ],
    ],
  );

  out();
  out(color.bold('  Installed agents'));
  const installed = agents.filter((agent) => agent.installed);
  if (installed.length === 0) {
    note('None found. Install one, or run `anyagent ls` to see the options.');
  } else {
    printTable(
      [{ header: 'agent' }, { header: 'version' }, { header: 'path' }],
      installed.map((agent) => [
        agent.id,
        agent.version ?? color.dim('unknown'),
        color.dim(agent.path ?? ''),
      ]),
    );
  }

  out();
  out(color.bold('  Credentials'));
  if (stored.length === 0) {
    note('No saved keys. Add one with `anyagent auth add openrouter`.');
  } else {
    note(`${stored.length} saved: ${stored.join(', ')}`);
  }
  if (credential)
    note(`default provider key from ${credential.origin} (${maskKey(credential.key)})`);

  // Warn about the two conditions that actually bite people.
  out();
  const store = cli.store;
  if (store instanceof FileStore && (await store.isExposed())) {
    warn(
      `${cli.paths.credentials} is readable by other users. Run: chmod 600 "${cli.paths.credentials}"`,
    );
  }
  if (pending.length > 0) {
    warn(`Config written for: ${pending.join(', ')}. Undo with \`anyagent restore <agent>\`.`);
  }
  if (report.catalog.stale) {
    note('Model catalog is stale - refresh with `anyagent update`.');
  }
  if (!cli.config.provider) {
    note('No default provider yet. Set one with `anyagent use <provider>/<model>`.');
  }
  out();
  return 0;
}

function describeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown age';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'fresh';
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

/** `anyagent restore <agent|--all>` */
export async function restoreCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    all: { type: 'boolean', description: 'Restore every agent anyagent has touched' },
  });

  const pending = await pendingRestores(cli.paths);
  if (pending.length === 0) {
    success('Nothing to restore - anyagent has not modified any agent config.');
    return 0;
  }

  const targets =
    parsed.flags.all === true
      ? pending
      : parsed.positionals.length > 0
        ? parsed.positionals.map((name) => {
            const agent = findAgent(name);
            if (!agent) throw new AnyAgentError(`Unknown agent "${name}".`);
            return agent.id;
          })
        : undefined;

  if (!targets) {
    heading('  Agents with anyagent changes');
    out();
    for (const id of pending) note(`${symbols.bullet} ${id}`);
    out();
    note('Restore one with `anyagent restore <agent>`, or all with `anyagent restore --all`.');
    out();
    return 0;
  }

  for (const id of targets) {
    if (!pending.includes(id)) {
      note(`${id}: nothing to restore.`);
      continue;
    }
    if (isInteractive() && !cli.yes && !(await confirm(`  Restore ${id} config?`, true))) continue;

    const result = await restoreAgent(id, cli.paths);
    for (const file of result.restored) success(`${id}: restored ${file}`);
    for (const file of result.removed) success(`${id}: removed ${file}`);
    for (const file of result.missing) failure(`${id}: backup missing for ${file}`);
  }
  return 0;
}

/** `anyagent update` - refresh the model catalog. */
export async function updateCommand(cli: Cli, argv: string[]): Promise<number> {
  parseArgs(argv, {});
  out();
  note('Refreshing the model catalog from models.dev ...');
  const catalog = await cli.catalog({ force: true });
  const models = [...catalog.models.values()].reduce((total, list) => total + list.length, 0);

  if (catalog.origin === 'network') {
    success(`Catalog updated: ${catalog.providers.length} providers, ${models} models.`);
  } else if (await pathExists(cli.paths.catalogCache)) {
    warn('Could not reach models.dev; the cached catalog is still in use.');
  } else {
    warn('Could not reach models.dev; using the catalog bundled with this release.');
  }
  out();
  return catalog.origin === 'network' ? 0 : 1;
}
