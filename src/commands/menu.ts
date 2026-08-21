/**
 * The menu you get from typing `anyagent` on its own.
 *
 * This is the front door, and the only thing it has to do is let someone who
 * has never read the documentation get to a running agent: arrow keys, Enter,
 * done. Everything the CLI can do is still available as a command, but nobody
 * should have to learn one to start.
 *
 * Without a terminal there is nothing to select, so the caller falls back to
 * printing help.
 */

import { AGENTS } from '../agents/index.js';
import { resolveDefaults } from '../config.js';
import type { Cli } from '../context.js';
import { CancelledError } from '../errors.js';
import { isInteractive, select, type SelectItem } from '../prompt.js';
import { locate } from '../runner.js';
import type { Agent } from '../types.js';
import { color, out, symbols } from '../ui.js';
import { doctorCommand } from './maintenance.js';
import { runCommand } from './run.js';
import { chooseModel, chooseProvider, promptForKey } from './setup.js';

const ACTION_PREFIX = 'action:';

export async function menuCommand(cli: Cli): Promise<number> {
  for (;;) {
    const choice = await pick(cli).catch((error: unknown) => {
      if (error instanceof CancelledError) return undefined;
      throw error;
    });

    if (choice === undefined) {
      out();
      return 0;
    }

    if (!choice.startsWith(ACTION_PREFIX)) {
      // Selecting an agent runs it. The menu does not come back afterwards -
      // the session is over when the agent exits.
      return runCommand(cli, [choice]);
    }

    const action = choice.slice(ACTION_PREFIX.length);
    if (action === 'quit') {
      out();
      return 0;
    }
    await runAction(cli, action);
  }
}

async function pick(cli: Cli): Promise<string> {
  const installed = new Map<string, boolean>();
  for (const agent of AGENTS) {
    installed.set(agent.id, Boolean(locate(agent, cli.home, cli.platform)));
  }

  // Ready-to-run first, then installed-but-unconfigured, then the rest. The
  // first screen should be the things that will actually work right now.
  const sorted = [...AGENTS].sort((a, b) => {
    const byInstalled = Number(installed.get(b.id)) - Number(installed.get(a.id));
    if (byInstalled !== 0) return byInstalled;
    return AGENTS.indexOf(a) - AGENTS.indexOf(b);
  });

  // Both columns are padded to the widest entry, so the status column lines up
  // instead of stepping in and out with the length of each product name.
  const idWidth = Math.max(...AGENTS.map((agent) => agent.id.length), 8) + 2;
  const nameWidth = Math.max(...AGENTS.map((agent) => agent.name.length)) + 2;

  const items: SelectItem[] = sorted.map((agent) => ({
    value: agent.id,
    label: pad(agent.id, idWidth) + color.dim(pad(agent.name, nameWidth)),
    detail: status(cli, agent, installed.get(agent.id) === true),
    keywords: `${agent.name} ${agent.description}`,
  }));

  const current = cli.config.model
    ? `${cli.config.provider ?? '?'} / ${cli.config.model}`
    : 'not set yet';

  const action = (name: string, description: string): string =>
    pad(name, idWidth) + color.dim(pad(description, nameWidth));

  items.push(
    { value: 'sep', label: '', separator: true },
    {
      value: `${ACTION_PREFIX}model`,
      label: action('model', 'Choose the AI model'),
      detail: current,
    },
    {
      value: `${ACTION_PREFIX}key`,
      label: action('key', 'Add an API key'),
      detail: `${(await cli.store.list()).length} saved`,
    },
    { value: `${ACTION_PREFIX}check`, label: action('check', 'Check my setup') },
    { value: `${ACTION_PREFIX}quit`, label: action('quit', 'Exit') },
  );

  // On a fresh install, say what is about to happen. After that, get out of
  // the way - the list is self-explanatory once it has been seen once.
  const firstRun = !cli.config.model && !cli.config.provider;
  const title = firstRun
    ? `  ${color.bold('anyagent')} ${color.dim('- pick one, and I will ask for a key and a model')}`
    : `  ${color.bold('anyagent')} ${color.dim('- pick what to run')}`;

  out();
  return select(title, items, {
    // The list is short enough to show whole on a normal terminal; only scroll
    // when the window genuinely cannot fit it.
    pageSize: items.length,
    current: cli.config.lastAgent ?? sorted[0]?.id,
  });
}

function status(cli: Cli, agent: Agent, isInstalled: boolean): string {
  if (!isInstalled) return color.dim('not installed');

  const defaults = resolveDefaults({
    agentId: agent.id,
    user: cli.config,
    project: cli.project.config,
    env: cli.env,
    flags: {},
  });

  if (!defaults.model) return color.yellow('needs a model');
  return `${color.green(symbols.ok)} ${defaults.model}`;
}

function pad(text: string, size: number): string {
  return text.length >= size ? `${text} ` : text + ' '.repeat(size - text.length);
}

async function runAction(cli: Cli, action: string): Promise<void> {
  switch (action) {
    case 'model': {
      const catalog = await cli.catalog();
      const provider = await chooseProvider(cli, catalog, undefined, undefined);
      await chooseModel(cli, catalog, provider, undefined);
      return;
    }
    case 'key': {
      const catalog = await cli.catalog();
      const provider = await chooseProvider(cli, catalog, undefined, undefined);
      await promptForKey(cli, provider);
      return;
    }
    case 'check':
      await doctorCommand(cli, []);
      return;
    default:
      return;
  }
}

/** True when the menu can be shown at all. */
export function canShowMenu(): boolean {
  return isInteractive();
}
