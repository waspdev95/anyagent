/**
 * Interactive prompts.
 *
 * Built on `node:readline` and raw-mode key handling rather than a prompt
 * library, so the dependency count stays at zero and the behaviour is identical
 * in cmd.exe, PowerShell, Windows Terminal and any POSIX shell.
 *
 * Every prompt refuses to run without a TTY. A CLI that blocks forever inside
 * CI is worse than one that fails with an explanation.
 */

import readline from 'node:readline';

import { CancelledError, AnyAgentError } from './errors.js';
import { color, symbols } from './ui.js';

const ESC = '\u001B';

export interface PromptOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export function isInteractive(streams: PromptOptions = {}): boolean {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  return Boolean(input.isTTY && output.isTTY);
}

function requireTty(what: string, streams: PromptOptions): void {
  if (isInteractive(streams)) return;
  throw new AnyAgentError(`${what} needs an interactive terminal.`, {
    hint: 'Pass the value as a flag, or set the matching environment variable, when running non-interactively.',
  });
}

/** Yes/no question. Enter accepts the default. */
export async function confirm(
  question: string,
  defaultValue = true,
  streams: PromptOptions = {},
): Promise<boolean> {
  requireTty('Confirmation', streams);
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${color.dim(suffix)} `, streams)).trim().toLowerCase();
  if (answer === '') return defaultValue;
  return answer === 'y' || answer === 'yes';
}

/** Free-text question, with optional masking for secrets. */
export async function text(
  question: string,
  options: { defaultValue?: string; mask?: boolean } & PromptOptions = {},
): Promise<string> {
  requireTty('This prompt', options);
  const hint = options.defaultValue ? color.dim(` (${options.defaultValue})`) : '';
  const answer = await ask(`${question}${hint} `, options, options.mask);
  const value = answer.trim();
  if (value === '' && options.defaultValue !== undefined) return options.defaultValue;
  return value;
}

function ask(query: string, streams: PromptOptions, mask = false): Promise<string> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const rl = readline.createInterface({ input, output, terminal: true });

  if (mask) {
    // Echo a bullet per keystroke instead of the character itself. Writing the
    // query once up front keeps it from being re-rendered on every key.
    const asMutable = rl as unknown as { _writeToOutput(text: string): void };
    let started = false;
    asMutable._writeToOutput = (text: string): void => {
      if (!started) {
        output.write(query);
        started = true;
        return;
      }
      if (text.includes('\n')) output.write('\n');
      else output.write('*');
    };
  }

  return new Promise<string>((resolve, reject) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      output.write('\n');
      reject(new CancelledError());
    });
  });
}

export interface SelectItem {
  value: string;
  label: string;
  /** Secondary text shown to the right. */
  detail?: string;
  /** Extra text matched when filtering, but not displayed. */
  keywords?: string;
  /** A heading or rule: displayed, never selectable, hidden while filtering. */
  separator?: boolean;
}

export interface SelectOptions extends PromptOptions {
  /** Pre-selected value. */
  current?: string;
  /** Rows visible at once. */
  pageSize?: number;
}

/**
 * Single-select list with type-to-filter.
 *
 * Keys: arrows or Ctrl-N/Ctrl-P to move, Enter to accept, Esc or Ctrl-C to
 * cancel, printable characters to filter, Backspace to edit the filter.
 */
export async function select(
  title: string,
  items: SelectItem[],
  options: SelectOptions = {},
): Promise<string> {
  requireTty('Selection', options);
  if (items.length === 0) throw new AnyAgentError('Nothing to choose from.');

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const pageSize = Math.max(3, Math.min(options.pageSize ?? 12, (output.rows ?? 24) - 6));

  let filter = '';
  let visible = items;
  let index = Math.max(
    0,
    items.findIndex((item) => item.value === options.current && !item.separator),
  );
  let drawnLines = 0;

  /** Move to the next selectable row, skipping separators and wrapping. */
  const step = (direction: 1 | -1): void => {
    const count = visible.length;
    if (count === 0) return;
    for (let hop = 1; hop <= count; hop += 1) {
      const next = (index + direction * hop + count * hop) % count;
      if (!visible[next]?.separator) {
        index = next;
        return;
      }
    }
  };

  const render = (): void => {
    const lines: string[] = [];
    lines.push(`${color.bold(title)}${filter ? color.dim(`  /${filter}`) : ''}`);

    if (visible.length === 0) {
      lines.push(color.dim('  no matches'));
    } else {
      const start = Math.max(
        0,
        Math.min(index - Math.floor(pageSize / 2), visible.length - pageSize),
      );
      const window = visible.slice(Math.max(0, start), Math.max(0, start) + pageSize);
      for (const [offset, item] of window.entries()) {
        if (item.separator) {
          lines.push(item.label ? color.dim(`  ${item.label}`) : '');
          continue;
        }
        const position = Math.max(0, start) + offset;
        const active = position === index;
        const pointer = active ? color.cyan(symbols.pointer) : ' ';
        const label = active ? color.cyan(item.label) : item.label;
        const detail = item.detail ? color.dim(`  ${item.detail}`) : '';
        lines.push(`${pointer} ${label}${detail}`);
      }
      if (visible.length > pageSize) {
        lines.push(color.dim(`  ${index + 1}/${visible.length}`));
      }
    }
    lines.push(color.dim('  type to filter  enter select  esc cancel'));

    if (drawnLines > 0) output.write(`${ESC}[${drawnLines}A${ESC}[0J`);
    output.write(`${lines.join('\n')}\n`);
    drawnLines = lines.length;
  };

  const applyFilter = (): void => {
    const needle = filter.toLowerCase();
    visible = needle
      ? items.filter((item) =>
          `${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
      : items;
    index = Math.min(index, Math.max(0, visible.length - 1));
  };

  if (visible[index]?.separator) step(1);

  const wasRaw = input.isRaw ?? false;
  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  output.write(`${ESC}[?25l`); // hide cursor
  render();

  return new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      input.off('keypress', onKeypress);
      if (input.isTTY) input.setRawMode(wasRaw);
      output.write(`${ESC}[?25h`);
      fn();
    };

    function onKeypress(chunk: string, key: readline.Key): void {
      if (!key) return;
      const control = key.ctrl === true;

      if (key.name === 'return' || key.name === 'enter') {
        const chosen = visible[index];
        if (!chosen || chosen.separator) return;
        finish(() => resolve(chosen.value));
        return;
      }
      if (key.name === 'escape' || (control && key.name === 'c')) {
        finish(() => reject(new CancelledError()));
        return;
      }
      if (key.name === 'up' || (control && key.name === 'p')) {
        step(-1);
        render();
        return;
      }
      if (key.name === 'down' || (control && key.name === 'n') || key.name === 'tab') {
        step(1);
        render();
        return;
      }
      if (key.name === 'backspace') {
        filter = filter.slice(0, -1);
        applyFilter();
        render();
        return;
      }
      if (control || key.meta) return;
      if (chunk && chunk.length === 1 && chunk >= ' ') {
        filter += chunk;
        applyFilter();
        render();
      }
    }

    input.on('keypress', onKeypress);
  });
}
