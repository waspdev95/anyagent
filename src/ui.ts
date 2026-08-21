/**
 * Terminal output. No dependencies: colour is a handful of escape codes and a
 * capability check, and everything degrades to plain text when piped.
 */

const ESC = '\u001B';
const FORCE = process.env.FORCE_COLOR;

function colorEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (FORCE !== undefined && FORCE !== '' && FORCE !== '0') return true;
  if (process.env.TERM === 'dumb') return false;
  return Boolean(stream.isTTY);
}

let enabled = colorEnabled(process.stdout);

/** Test hook: force colour on or off. */
export function setColorEnabled(value: boolean): void {
  enabled = value;
}

function wrap(open: number, close: number) {
  return (text: string): string => (enabled ? `${ESC}[${open}m${text}${ESC}[${close}m` : text);
}

export const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export const symbols = {
  ok: process.platform === 'win32' ? '+' : '✔',
  fail: process.platform === 'win32' ? 'x' : '✖',
  warn: '!',
  bullet: process.platform === 'win32' ? '-' : '•',
  arrow: process.platform === 'win32' ? '->' : '→',
  pointer: process.platform === 'win32' ? '>' : '❯',
};

/**
 * Output sinks.
 *
 * Everything anyagent prints goes through these two, so tests can capture
 * output without touching `process.stdout` - which the test runner writes its
 * own report to.
 */
interface Sink {
  write(chunk: string): unknown;
}

let stdout: Sink = process.stdout;
let stderr: Sink = process.stderr;

/** Redirect output. Returns a function that puts the previous sinks back. */
export function setStreams(next: { stdout?: Sink; stderr?: Sink }): () => void {
  const previous = { stdout, stderr };
  if (next.stdout) stdout = next.stdout;
  if (next.stderr) stderr = next.stderr;
  return () => {
    stdout = previous.stdout;
    stderr = previous.stderr;
  };
}

export function out(line = ''): void {
  stdout.write(`${line}\n`);
}

export function err(line = ''): void {
  stderr.write(`${line}\n`);
}

export function heading(text: string): void {
  out();
  out(color.bold(text));
}

export function success(text: string): void {
  out(`${color.green(symbols.ok)} ${text}`);
}

export function warn(text: string): void {
  err(`${color.yellow(symbols.warn)} ${text}`);
}

export function failure(text: string): void {
  err(`${color.red(symbols.fail)} ${text}`);
}

export function note(text: string): void {
  out(color.gray(`  ${text}`));
}

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Visible width, ignoring ANSI escapes. */
export function width(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

export function pad(text: string, size: number): string {
  const diff = size - width(text);
  return diff > 0 ? text + ' '.repeat(diff) : text;
}

export interface TableColumn {
  header: string;
  align?: 'left' | 'right';
}

/**
 * Render aligned columns. Deliberately borderless: output stays greppable and
 * copy-pasteable, which matters more in a CLI than box drawing.
 */
export function table(
  columns: TableColumn[],
  rows: string[][],
  indent = '  ',
  showHeader = true,
): string[] {
  const widths = columns.map((column, index) =>
    Math.max(width(column.header), ...rows.map((row) => width(row[index] ?? ''))),
  );

  const render = (cells: string[]): string =>
    indent +
    cells
      .map((cell, index) => {
        const size = widths[index] ?? 0;
        if (columns[index]?.align === 'right') {
          return ' '.repeat(Math.max(0, size - width(cell))) + cell;
        }
        return index === cells.length - 1 ? cell : pad(cell, size);
      })
      .join('  ')
      .trimEnd();

  const body = rows.map(render);
  return showHeader
    ? [render(columns.map((column) => color.dim(column.header.toUpperCase()))), ...body]
    : body;
}

export function printTable(
  columns: TableColumn[],
  rows: string[][],
  indent = '  ',
  showHeader = true,
): void {
  for (const line of table(columns, rows, indent, showHeader)) out(line);
}

/** 128000 -> "128K", 1000000 -> "1M". */
export function formatTokens(value: number | undefined): string {
  if (!value || value <= 0) return '-';
  if (value >= 1_000_000) return `${round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${round(value / 1_000)}K`;
  return String(value);
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

/** Catalog cost is USD per 1M tokens. */
export function formatCost(value: number | undefined): string {
  if (value === undefined) return '-';
  if (value === 0) return 'free';
  return `$${value.toFixed(2)}`;
}

export function json(value: unknown): void {
  out(JSON.stringify(value, null, 2));
}
