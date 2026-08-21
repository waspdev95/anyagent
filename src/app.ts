/**
 * Command dispatch.
 *
 * The dispatcher is deliberately thin, and one rule shapes it: if the first
 * word is an agent, it is a launch. `anyagent claude` and `anyagent run claude`
 * are the same thing, because nobody should have to type `run`.
 */

import { findAgent, agentNames } from './agents/index.js';
import { closest } from './args.js';
import { authCommand } from './commands/auth.js';
import { configCommand, useCommand } from './commands/config.js';
import { envCommand, execCommand } from './commands/exec.js';
import { compatCommand, lsCommand, modelsCommand, providersCommand } from './commands/list.js';
import { doctorCommand, restoreCommand, updateCommand } from './commands/maintenance.js';
import { RUN_FLAGS, runCommand } from './commands/run.js';
import { createCli, type Cli } from './context.js';
import { AnyAgentError, CancelledError, redact } from './errors.js';
import { MissingValueError, UnknownFlagError } from './args.js';
import { color, err, failure, out, printTable, symbols } from './ui.js';
import { VERSION } from './version.js';

type Command = (cli: Cli, argv: string[]) => Promise<number>;

interface CommandSpec {
  run: Command;
  summary: string;
  usage: string;
}

const COMMANDS: Record<string, CommandSpec> = {
  run: { run: runCommand, summary: 'Launch an agent', usage: 'run <agent> [options] [-- args]' },
  ls: {
    run: lsCommand,
    summary: 'List agents and their status',
    usage: 'ls [--installed] [--versions]',
  },
  providers: {
    run: providersCommand,
    summary: 'Browse model providers',
    usage: 'providers [query] [--agent <id>]',
  },
  models: {
    run: modelsCommand,
    summary: 'Search models',
    usage: 'models [query] [--provider <id>]',
  },
  compat: {
    run: compatCommand,
    summary: 'Show which agents work with which providers',
    usage: 'compat [agent]',
  },
  use: {
    run: useCommand,
    summary: 'Set the default provider and model',
    usage: 'use <provider>[/<model>]',
  },
  auth: {
    run: authCommand,
    summary: 'Manage API keys',
    usage: 'auth <add|list|rm|test> [provider]',
  },
  config: {
    run: configCommand,
    summary: 'Read and write configuration',
    usage: 'config <list|get|set|unset|path>',
  },
  exec: {
    run: execCommand,
    summary: 'Run any command against the chosen model',
    usage: 'exec -- <command>',
  },
  env: {
    run: envCommand,
    summary: 'Print environment variables for eval',
    usage: 'env [--shell posix]',
  },
  doctor: { run: doctorCommand, summary: 'Diagnose the installation', usage: 'doctor' },
  restore: {
    run: restoreCommand,
    summary: 'Undo config changes anyagent made',
    usage: 'restore <agent|--all>',
  },
  update: { run: updateCommand, summary: 'Refresh the model catalog', usage: 'update' },
};

const ALIASES: Record<string, string> = {
  list: 'ls',
  agents: 'ls',
  provider: 'providers',
  model: 'models',
  keys: 'auth',
  login: 'auth',
};

export async function main(argv: string[]): Promise<number> {
  // Global flags are extracted first so they work in any position.
  const globals = { json: false, yes: false, help: false, version: false };
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

  const [first, ...args] = rest;

  if (globals.help || !first) {
    printHelp(first);
    return first ? 0 : 0;
  }

  const cli = await createCli({ json: globals.json, yes: globals.yes });

  const commandName = ALIASES[first] ?? first;
  const command = COMMANDS[commandName];
  if (command) return command.run(cli, args);

  // Not a command - if it names an agent, launch it.
  if (findAgent(first)) return runCommand(cli, rest);

  const suggestion = closest(first, [...Object.keys(COMMANDS), ...agentNames()]);
  throw new AnyAgentError(`Unknown command "${first}".`, {
    hint: suggestion
      ? `Did you mean "${suggestion}"?`
      : 'Run `anyagent --help` to see the commands, or `anyagent ls` for agents.',
  });
}

function printHelp(topic?: string): void {
  const spec = topic ? COMMANDS[ALIASES[topic] ?? topic] : undefined;

  out();
  out(
    `  ${color.bold('anyagent')} ${color.dim(VERSION)}  ${color.dim('Any coding agent. Any model. One command.')}`,
  );
  out();

  if (spec && topic) {
    out(`  ${color.bold('USAGE')}`);
    out(`    anyagent ${spec.usage}`);
    out();
    out(`  ${spec.summary}`);
    out();
    return;
  }

  out(`  ${color.bold('USAGE')}`);
  out('    anyagent <agent> [options] [-- agent args]');
  out('    anyagent <command> [options]');
  out();

  out(`  ${color.bold('QUICK START')}`);
  out(`    anyagent auth add openrouter        ${color.dim('save a key, once')}`);
  out(`    anyagent use openrouter/deepseek/deepseek-chat`);
  out(`    anyagent claude                     ${color.dim('launch with those defaults')}`);
  out();

  out(`  ${color.bold('COMMANDS')}`);
  printTable(
    [{ header: '' }, { header: '' }],
    Object.entries(COMMANDS).map(([name, entry]) => [name, color.dim(entry.summary)]),
    '    ',
    false,
  );
  out();

  out(`  ${color.bold('OPTIONS')}`);
  printTable(
    [{ header: '' }, { header: '' }],
    [
      ...Object.entries(RUN_FLAGS).map(([name, flag]) => [
        `--${name}${flag.short ? `, -${flag.short}` : ''} ${flag.value ?? ''}`.trim(),
        color.dim(flag.description),
      ]),
      ['--json', color.dim('Machine-readable output')],
      ['--yes, -y', color.dim('Accept prompts without asking')],
      ['--version, -V', color.dim('Print the version')],
    ],
    '    ',
    false,
  );
  out();
  out(`  ${color.dim('Docs: https://github.com/anyagent/anyagent')}`);
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
    err(color.dim('  Run `anyagent --help` for the options.'));
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
      `  ${symbols.bullet} Please report this: https://github.com/anyagent/anyagent/issues`,
    ),
  );
  err();
  return 1;
}
