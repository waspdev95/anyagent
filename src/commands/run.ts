/**
 * `anyagent run <agent>` - and its implicit form, `anyagent <agent>`.
 *
 * This is the only command most people will ever type, so the work it does is
 * mostly about not asking twice: a provider, a key and a model are chosen once
 * and remembered, and every later launch is a single word.
 */

import { parseArgs, type FlagSpecs } from '../args.js';
import { findAgent, agentNames } from '../agents/index.js';
import { closest } from '../args.js';
import type { Cli } from '../context.js';
import { resolveDefaults, saveUserConfig } from '../config.js';
import { keyLooksWrong, resolveKey } from '../credentials.js';
import { AnyAgentError, maskKey } from '../errors.js';
import { buildTarget } from '../resolve.js';
import {
  applyFiles,
  detectVersion,
  launch,
  locate,
  notInstalled,
  readExisting,
} from '../runner.js';
import type { Agent, LaunchPlan, PlanContext, Target } from '../types.js';
import { color, json as printJson, note, out, success, warn } from '../ui.js';
import { chooseModel, chooseProvider, promptForKey, installAgent } from './setup.js';

export const RUN_FLAGS: FlagSpecs = {
  model: { type: 'string', short: 'm', value: '<id>', description: 'Model to run' },
  // No `-p` alias here on purpose: several agents use `-p` for "print" or
  // "prompt", and silently stealing it would be the most annoying kind of bug.
  provider: { type: 'string', value: '<id>', description: 'Provider to use' },
  small: { type: 'string', value: '<id>', description: 'Cheap model for background tasks' },
  'base-url': { type: 'string', value: '<url>', description: 'Override the provider endpoint' },
  'api-key': { type: 'string', value: '<key>', description: 'Use this key once, without saving' },
  save: { type: 'boolean', description: 'Remember these choices for this agent' },
  'print-env': { type: 'boolean', description: 'Print the environment instead of launching' },
  'dry-run': { type: 'boolean', description: 'Show the resolved plan and exit' },
};

export async function runCommand(cli: Cli, argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, RUN_FLAGS, { forwardUnknown: true, maxPositionals: 1 });
  const name = parsed.positionals[0];
  if (!name) {
    throw new AnyAgentError('Which agent?', {
      hint: 'For example: anyagent claude\nRun `anyagent ls` to see what is available.',
    });
  }

  const agent = findAgent(name);
  if (!agent) {
    const suggestion = closest(name, agentNames());
    throw new AnyAgentError(`Unknown agent "${name}".`, {
      hint: suggestion
        ? `Did you mean "${suggestion}"? Run \`anyagent ls\` for the full list.`
        : 'Run `anyagent ls` for the full list.',
    });
  }

  for (const flag of parsed.unknown) {
    const guess = closest(flag.replace(/^-+/, ''), Object.keys(RUN_FLAGS));
    if (guess) {
      warn(`Passing ${flag} through to ${agent.name}. Did you mean --${guess}?`);
    }
  }

  const { flags } = parsed;
  const defaults = resolveDefaults({
    agentId: agent.id,
    user: cli.config,
    project: cli.project.config,
    projectFile: cli.project.file,
    env: cli.env,
    flags: {
      provider: asString(flags.provider),
      model: asString(flags.model),
      smallModel: asString(flags.small),
    },
  });

  const catalog = await cli.catalog();

  // Provider, key and model, asking only for what is still unknown.
  const provider = await chooseProvider(cli, catalog, agent, defaults.provider);
  const credential =
    (await resolveKey(provider, cli.store, cli.env, asString(flags['api-key']))) ??
    (await promptForKey(cli, provider));

  const warning = keyLooksWrong(provider, credential.key);
  if (warning && !provider.keyless) warn(warning);

  const modelId = await chooseModel(cli, catalog, provider, defaults.model);

  const target = buildTarget({
    agent,
    catalog,
    providerId: provider.id,
    modelId,
    smallModelId: defaults.smallModel,
    baseUrlOverride: asString(flags['base-url']),
    apiKey: credential.key,
  });

  if (flags.save === true) {
    await remember(cli, agent.id, target);
    success(`Saved ${provider.id}/${target.model.id} as the default for ${agent.name}.`);
  }

  const binary = locate(agent, cli.home, cli.platform);
  const resolvedBinary = binary ?? (await installAgent(cli, agent));
  if (!resolvedBinary) throw notInstalled(agent);

  // Only agents whose config depends on their release ask for a version, and
  // the answer is cached: this stays off the critical path of a launch.
  const agentVersion = agent.versionArgs
    ? await detectVersion(agent, resolvedBinary, cli.paths.versionCache)
    : undefined;
  const context: PlanContext = {
    target,
    passthrough: [...defaults.args, ...parsed.passthrough],
    home: cli.home,
    stateDir: cli.paths.state,
    platform: cli.platform,
    now: new Date().toISOString(),
    existing: await readExisting(agent, {
      home: cli.home,
      stateDir: cli.paths.state,
      platform: cli.platform,
    }),
    ...(agentVersion ? { agentVersion } : {}),
  };

  const plan = agent.plan(context);

  if (flags['print-env'] === true) {
    printEnv(cli, plan);
    return 0;
  }

  if (flags['dry-run'] === true) {
    printPlan(cli, agent, target, plan, resolvedBinary);
    return 0;
  }

  await applyFiles(agent, plan, { paths: cli.paths, platform: cli.platform });

  printBanner(agent, target, plan, credential.origin);

  const result = await launch(plan, resolvedBinary, {
    paths: cli.paths,
    env: cli.env,
    cwd: cli.cwd,
    platform: cli.platform,
  });
  return result.code;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

async function remember(cli: Cli, agentId: string, target: Target): Promise<void> {
  const agents = { ...(cli.config.agents ?? {}) };
  agents[agentId] = {
    ...agents[agentId],
    provider: target.provider.id,
    model: target.model.id,
    ...(target.smallModel ? { smallModel: target.smallModel.id } : {}),
  };
  cli.config.agents = agents;
  await saveUserConfig(cli.paths.config, cli.config);
}

function printBanner(agent: Agent, target: Target, plan: LaunchPlan, keyOrigin: string): void {
  out();
  out(`  ${color.bold(agent.name)} ${color.dim('via')} ${color.cyan(target.provider.name)}`);
  note(`model   ${target.model.id}`);
  if (target.smallModel) note(`small   ${target.smallModel.id}`);
  note(`api     ${target.baseUrl}`);
  if (target.model.contextLimit)
    note(`context ${target.model.contextLimit.toLocaleString()} tokens`);
  note(`key     ${keyOrigin}`);
  for (const line of plan.notes) note(line);
  out();
}

function printEnv(cli: Cli, plan: LaunchPlan): void {
  if (cli.json) {
    printJson(plan.env);
    return;
  }
  const quote = cli.platform === 'win32' ? '' : "'";
  for (const [name, value] of Object.entries(plan.env)) {
    out(
      cli.platform === 'win32'
        ? `$env:${name} = "${value}"`
        : `export ${name}=${quote}${value}${quote}`,
    );
  }
}

/**
 * Secret-looking values are masked, everything else is shown.
 *
 * The name test is anchored so that `..._MAX_OUTPUT_TOKENS` - a plain number -
 * is not mistaken for a credential, and newlines are escaped so a multi-header
 * value cannot break the layout.
 */
const SECRET_NAME = /(API_KEY|AUTH_TOKEN|_TOKEN|_SECRET)$/;

export function displayValue(name: string, value: string): string {
  if (SECRET_NAME.test(name)) return maskKey(value);
  return value.includes('\n') ? JSON.stringify(value) : value;
}

function printPlan(cli: Cli, agent: Agent, target: Target, plan: LaunchPlan, binary: string): void {
  const summary = {
    agent: agent.id,
    provider: target.provider.id,
    wire: target.wire,
    baseUrl: target.baseUrl,
    model: target.model.id,
    smallModel: target.smallModel?.id,
    binary,
    command: [plan.command.file, ...plan.command.args],
    env: Object.fromEntries(
      Object.entries(plan.env).map(([name, value]) => [name, displayValue(name, value)]),
    ),
    files: plan.files.map((file) => file.path),
    notes: plan.notes,
  };

  if (cli.json) {
    printJson(summary);
    return;
  }

  out();
  out(color.bold(`  ${agent.name} would launch as:`));
  out();
  note(`${binary} ${plan.command.args.join(' ')}`);
  out();
  out(color.bold('  environment'));
  for (const [name, value] of Object.entries(summary.env)) note(`${name}=${value}`);
  if (plan.files.length > 0) {
    out();
    out(color.bold('  files'));
    for (const file of plan.files) note(`${file.path}${file.backup ? ' (backed up first)' : ''}`);
  }
  out();
}
