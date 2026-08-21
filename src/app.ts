/**
 * Command dispatch and help.
 *
 * Two rules shape this file, both about getting out of the way:
 *
 *   1. Typing `anyagent` on its own opens a menu, not a wall of text. Nobody
 *      should have to read documentation to run the thing once.
 *   2. If the first word is a tool, it is a launch. `anyagent claude` and
 *      `anyagent run claude` are the same, because nobody should have to type
 *      `run`.
 *
 * The help screen shows five commands. The other eight are real, documented and
 * one `--all` away - but they are not what the first thirty seconds are for.
 */

import { agentNames, findAgent } from './agents/index.js';
import { closest, MissingValueError, UnknownFlagError } from './args.js';
import { authCommand } from './commands/auth.js';
import { configCommand, useCommand } from './commands/config.js';
import { envCommand, execCommand } from './commands/exec.js';
import { compatCommand, lsCommand, modelsCommand, providersCommand } from './commands/list.js';
import { doctorCommand, restoreCommand, updateCommand } from './commands/maintenance.js';
import { menuCommand } from './commands/menu.js';
import { keyCommand, modelCommand } from './commands/model.js';
import { RUN_FLAGS, runCommand } from './commands/run.js';
import { createCli, type Cli } from './context.js';
import { AnyAgentError, CancelledError, redact } from './errors.js';
import { isInteractive } from './prompt.js';
import { color, err, failure, out, printTable, symbols } from './ui.js';
import { VERSION } from './version.js';

type Command = (cli: Cli, argv: string[]) => Promise<number>;

/** Which help section a command belongs to, and whether it is shown by default. */
type Group = 'run' | 'setup' | 'browse' | 'fix' | 'advanced';

interface CommandSpec {
  run: Command;
  summary: string;
  usage: string;
  group: Group;
  /** Shown on the short help screen. */
  essential?: boolean;
  /**
   * Kept working but not listed: an older spelling of something that now has a
   * better name. Two visible ways to do one thing is a question nobody should
   * have to answer.
   */
  hidden?: boolean;
}

const COMMANDS: Record<string, CommandSpec> = {
  run: {
    run: runCommand,
    summary: 'Run an agent (or just type its name)',
    usage: 'run <agent> [options] [-- extra args]',
    group: 'run',
  },
  ls: {
    run: lsCommand,
    summary: 'Which agents you have, and what they will use',
    usage: 'ls [--installed] [--versions]',
    group: 'browse',
    essential: true,
  },
  model: {
    run: modelCommand,
    summary: 'Choose the AI model',
    usage: 'model [<id>] [--agent <agent>]',
    group: 'setup',
    essential: true,
  },
  key: {
    run: keyCommand,
    summary: 'Save an API key',
    usage: 'key [<provider>] | key test <provider> | key rm <provider>',
    group: 'setup',
    essential: true,
  },
  models: {
    run: modelsCommand,
    summary: 'Search for a model',
    usage: 'models [query] [--provider <id>]',
    group: 'browse',
  },
  providers: {
    run: providersCommand,
    summary: 'Browse the places models come from',
    usage: 'providers [query] [--agent <agent>]',
    group: 'browse',
  },
  compat: {
    run: compatCommand,
    summary: 'Which providers work with which agent',
    usage: 'compat [agent] [--why]',
    group: 'browse',
  },
  doctor: {
    run: doctorCommand,
    summary: 'Check my setup',
    usage: 'doctor',
    group: 'fix',
    essential: true,
  },
  restore: {
    run: restoreCommand,
    summary: 'Undo any config anyagent wrote',
    usage: 'restore <agent|--all>',
    group: 'fix',
  },
  update: {
    run: updateCommand,
    summary: 'Refresh the list of models',
    usage: 'update',
    group: 'fix',
  },
  use: {
    run: useCommand,
    summary: 'Older name for `model`',
    usage: 'use <provider>/<model>',
    group: 'advanced',
    hidden: true,
  },
  auth: {
    run: authCommand,
    summary: 'Older name for `key`',
    usage: 'auth <add|list|rm|test> [provider]',
    group: 'advanced',
    hidden: true,
  },
  config: {
    run: configCommand,
    summary: 'Read and write settings',
    usage: 'config <list|get|set|unset|path>',
    group: 'advanced',
  },
  exec: {
    run: execCommand,
    summary: 'Run any command against the chosen model',
    usage: 'exec -- <command>',
    group: 'advanced',
  },
  env: {
    run: envCommand,
    summary: 'Print environment variables for eval',
    usage: 'env [--shell posix]',
    group: 'advanced',
  },
};

const ALIASES: Record<string, string> = {
  list: 'ls',
  agents: 'ls',
  tools: 'ls',
  provider: 'providers',
  keys: 'auth',
  login: 'auth',
  help: 'help',
};

const GROUP_TITLES: Record<Group, string> = {
  run: 'RUN',
  setup: 'SET UP',
  browse: 'LOOK AROUND',
  fix: 'WHEN SOMETHING IS OFF',
  advanced: 'ADVANCED',
};

export async function main(argv: string[]): Promise<number> {
  // Global flags are extracted first so they work in any position.
  const globals = { json: false, yes: false, help: false, version: false, all: false };
  const rest: string[] = [];
  let terminated = false;

  for (const token of argv) {
    if (terminated) {
      rest.push(token);
      continue;
    }
    if (token === '--') {
      terminated = true;
      rest.push(token);
      continue;
    }
    switch (token) {
      case '--json':
        globals.json = true;
        continue;
      case '-y':
      case '--yes':
        globals.yes = true;
        continue;
      case '-h':
      case '--help':
        globals.help = true;
        continue;
      case '-V':
      case '--version':
        globals.version = true;
        continue;
      default:
        rest.push(token);
    }
  }

  if (globals.version) {
    out(VERSION);
    return 0;
  }

  let [first, ...args] = rest;

  // `anyagent help [topic]` behaves like `--help`.
  if (first === 'help') {
    globals.help = true;
    globals.all = args.includes('--all') || args.includes('-a');
    [first, ...args] = args.filter((token) => token !== '--all' && token !== '-a');
  }

  if (globals.help) {
    printHelp(first, globals.all);
    return 0;
  }

  const cli = await createCli({ json: globals.json, yes: globals.yes });

  // Nothing to do: open the menu, or explain the tool when there is no terminal.
  if (!first) {
    if (!isInteractive() || globals.json) {
      printHelp();
      return 0;
    }
    return menuCommand(cli);
  }

  const commandName = ALIASES[first] ?? first;
  const command = COMMANDS[commandName];
  if (command) return command.run(cli, args);

  // Not a command - if it names an agent, run it.
  if (findAgent(first)) return runCommand(cli, rest);

  const suggestion = closest(first, [...Object.keys(COMMANDS), ...agentNames()]);
  throw new AnyAgentError(`Unknown command "${first}".`, {
    hint: suggestion
      ? `Did you mean "${suggestion}"?`
      : 'Run `anyagent` for the menu, or `anyagent help` for the commands.',
  });
}

export function printHelp(topic?: string, all = false): void {
  const spec = topic ? COMMANDS[ALIASES[topic] ?? topic] : undefined;

  out();
  out(
    `  ${color.bold('anyagent')} ${color.dim(VERSION)}  ${color.dim(
      'Run Claude Code, Codex and other coding agents on any AI model.',
    )}`,
  );
  out();

  if (spec && topic) {
    out(`  ${color.bold('USAGE')}`);
    out(`    anyagent ${spec.usage}`);
    out();
    out(`    ${spec.summary}`);
    out();
    return;
  }

  if (!all) {
    out(`  ${color.bold('START')}`);
    out(`    anyagent                    ${color.dim('menu: pick and run')}`);
    out(`    anyagent claude             ${color.dim('or name one directly')}`);
    out();

    out(`  ${color.bold('COMMANDS')}`);
    printTable(
      [{ header: '' }, { header: '' }],
      Object.entries(COMMANDS)
        .filter(([, entry]) => entry.essential)
        .map(([name, entry]) => [name, color.dim(entry.summary)]),
      '    ',
      false,
    );
    out();
    out(color.dim('    anyagent help --all          every command'));
    out(color.dim('    https://github.com/waspdev95/anyagent'));
    out();
    return;
  }

  for (const group of ['run', 'setup', 'browse', 'fix', 'advanced'] as Group[]) {
    const entries = Object.entries(COMMANDS).filter(
      ([, entry]) => entry.group === group && !entry.hidden,
    );
    if (entries.length === 0) continue;
    out(`  ${color.bold(GROUP_TITLES[group])}`);
    printTable(
      [{ header: '' }, { header: '' }],
      entries.map(([name, entry]) => [name, color.dim(entry.summary)]),
      '    ',
      false,
    );
    out();
  }

  out(`  ${color.bold('OPTIONS WHEN RUNNING AN AGENT')}`);
  printTable(
    [{ header: '' }, { header: '' }],
    Object.entries(RUN_FLAGS).map(([name, flag]) => [
      `--${name}${flag.short ? `, -${flag.short}` : ''} ${flag.value ?? ''}`.trim(),
      color.dim(flag.description),
    ]),
    '    ',
    false,
  );
  out();
  out(`  ${color.bold('ANYWHERE')}`);
  printTable(
    [{ header: '' }, { header: '' }],
    [
      ['--json', color.dim('Machine-readable output')],
      ['--yes, -y', color.dim('Accept prompts without asking')],
      ['--version, -V', color.dim('Print the version')],
    ],
    '    ',
    false,
  );
  out();
  out(color.dim('  Anything anyagent does not recognise is passed to the agent itself.'));
  out(color.dim('  https://github.com/waspdev95/anyagent'));
  out();
}

/** Print an error the way a good CLI does: what happened, then what to do. */
export function reportError(error: unknown): number {
  if (error instanceof CancelledError) {
    err();
    return 130;
  }

  if (error instanceof AnyAgentError) {
    err();
    failure(redact(error.message));
    if (error.hint) {
      for (const line of error.hint.split('\n')) err(color.dim(`  ${line}`));
    }
    err();
    return error.exitCode;
  }

  if (error instanceof UnknownFlagError || error instanceof MissingValueError) {
    err();
    failure(error.message);
    err(color.dim('  Run `anyagent help` for the commands.'));
    err();
    return 2;
  }

  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  err();
  failure('Unexpected error.');
  err(color.dim(redact(message)));
  err();
  err(
    color.dim(
      `  ${symbols.bullet} Please report this: https://github.com/waspdev95/anyagent/issues`,
    ),
  );
  err();
  return 1;
}
