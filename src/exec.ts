/**
 * Finding and running agent binaries.
 *
 * This is where cross-platform CLIs usually break, so it is deliberate rather
 * than clever:
 *
 *   - Global npm installs on Windows produce `foo.cmd` shims, not `foo.exe`.
 *     Node refuses to spawn `.cmd` directly since CVE-2024-27980, so batch
 *     files are run through `cmd.exe /d /s /c` with verbatim arguments and
 *     manual quoting. Everything else spawns directly, with no shell involved.
 *   - Installers routinely drop binaries in directories that are not on PATH
 *     yet (`~/.local/bin`, `~/.bun/bin`, `~/.opencode/bin`). Those are searched
 *     after PATH so a real PATH entry always wins.
 *   - stdio is inherited: agents are full-screen TUIs and must own the terminal.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Directories searched after PATH. */
  extraPaths?: string[];
  /** Injected in tests. */
  isFile?: (file: string) => boolean;
}

/**
 * Locate an executable by name, honouring PATHEXT on Windows.
 * Returns the absolute path, or undefined when nothing matches.
 */
export function which(name: string, options: ResolveOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? defaultIsFile;

  // Path helpers must follow the *target* platform, not the host: `which` takes
  // a platform argument, and joining a POSIX PATH with backslashes would
  // quietly find nothing.
  const paths = platform === 'win32' ? path.win32 : path.posix;

  // An explicit path is used as-is.
  if (name.includes('/') || name.includes('\\')) {
    return isFile(name) ? paths.resolve(name) : undefined;
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  const separator = platform === 'win32' ? ';' : ':';
  const directories = [
    ...pathValue.split(separator).filter(Boolean),
    ...(options.extraPaths ?? []),
  ];

  const extensions =
    platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];

  for (const directory of directories) {
    const base = paths.join(stripQuotes(directory), name);
    for (const extension of extensions) {
      // PATHEXT is conventionally uppercase but installers write lowercase
      // names. NTFS matches either, so try lowercase first and report the path
      // the way it actually appears on disk.
      for (const candidate of variants(base, extension, platform)) {
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function variants(base: string, extension: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [base + extension];
  const lower = extension.toLowerCase();
  return lower === extension ? [base + extension] : [base + lower, base + extension];
}

function stripQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1');
}

/**
 * Directory contents, read once per process.
 *
 * A naive `which` stats every (directory x extension x agent) combination -
 * thousands of syscalls when listing a dozen agents against a long PATH. Listing
 * each directory once and answering from a set turns that into a handful of
 * reads, which is the difference between `anyagent ls` feeling instant or not.
 */
const directoryIndex = new Map<string, Set<string>>();

function indexOf(directory: string): Set<string> {
  const cached = directoryIndex.get(directory);
  if (cached) return cached;
  let entries: Set<string>;
  try {
    entries = new Set(fs.readdirSync(directory).map((name) => name.toLowerCase()));
  } catch {
    entries = new Set();
  }
  directoryIndex.set(directory, entries);
  return entries;
}

/** Test hook: forget cached directory listings. */
export function clearExecutableCache(): void {
  directoryIndex.clear();
}

function defaultIsFile(file: string): boolean {
  const directory = path.dirname(file);
  const name = path.basename(file);
  if (!indexOf(directory).has(name.toLowerCase())) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Directories installers use that are frequently missing from PATH. */
export function commonBinPaths(home: string, platform: NodeJS.Platform): string[] {
  const paths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, 'bin'),
  ];
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) paths.push(path.join(appData, 'npm'));
    paths.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps'));
  } else {
    paths.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  return paths;
}

export interface Command {
  file: string;
  args: string[];
  /** True when the command is run through cmd.exe. */
  viaShell: boolean;
}

/**
 * Quote a single argument for `cmd.exe` in verbatim mode.
 *
 * cmd.exe applies its own metacharacter pass before the target program parses
 * its command line, so `&`, `|`, `^`, `<`, `>` and friends must be caret-
 * escaped even inside quotes. Getting this wrong is how prompts containing a
 * `&` silently truncate.
 */
export function quoteForCmd(argument: string): string {
  if (argument === '') return '""';

  // Backslashes are only special when they precede a quote.
  let quoted = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  const needsQuotes = /[\s"]/.test(argument);
  if (needsQuotes) quoted = `"${quoted}"`;

  return quoted.replace(/[()%!^"<>&|]/g, (match) => (needsQuotes ? match : `^${match}`));
}

/**
 * Turn a resolved executable path into something `spawn` can run safely on the
 * current platform.
 */
export function buildCommand(
  resolved: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): Command {
  const extension = path.extname(resolved).toLowerCase();

  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    const line = [resolved, ...args].map(quoteForCmd).join(' ');
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      // /d skips AutoRun, /s keeps the outer quotes intact, /c runs and exits.
      args: ['/d', '/s', '/c', `"${line}"`],
      viaShell: true,
    };
  }

  if (platform === 'win32' && extension === '.ps1') {
    return {
      file: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved, ...args],
      viaShell: true,
    };
  }

  return { file: resolved, args, viaShell: false };
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  /** Injected in tests. */
  spawnImpl?: typeof spawn;
}

export interface RunResult {
  code: number;
  signal: NodeJS.Signals | null;
}

/**
 * Run an agent to completion, wired straight to this terminal.
 *
 * SIGINT is forwarded rather than handled: the agent decides what Ctrl-C means
 * (usually "cancel this turn"), and anyagent must not die out from under it.
 */
export function run(command: Command, options: RunOptions = {}): Promise<RunResult> {
  const spawnFn = options.spawnImpl ?? spawn;
  const platform = options.platform ?? process.platform;

  // Hand the terminal over before the child starts.
  //
  // Agents draw their own full-screen prompts. If this process is still reading
  // stdin - which it is, after any menu or prompt, because readline's keypress
  // decoder never detaches - then two processes race for every keystroke and the
  // child's arrow keys stop working. Pausing here is unconditional and cheap: it
  // costs nothing when no prompt ran, and it is the only thing standing between
  // a working agent and a stuck one.
  releaseTerminal();

  const child: ChildProcess = spawnFn(command.file, command.args, {
    stdio: 'inherit',
    env: options.env ?? process.env,
    cwd: options.cwd,
    windowsVerbatimArguments: command.viaShell && platform === 'win32',
    windowsHide: false,
  });

  const forward = (signal: NodeJS.Signals) => () => {
    if (!child.killed) child.kill(signal);
  };
  const onInterrupt = forward('SIGINT');
  const onTerminate = forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  return new Promise<RunResult>((resolve, reject) => {
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      resolve({ code: code ?? (signal ? 128 + signalNumber(signal) : 1), signal });
    });
  });

  function cleanup(): void {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

/**
 * Stop reading stdin in this process so a child can own the terminal.
 *
 * `stdio: 'inherit'` gives the child the same file descriptor, so it receives
 * every keystroke once this process stops competing for them.
 */
export function releaseTerminal(input: NodeJS.ReadStream = process.stdin): void {
  try {
    if (input.isTTY) input.setRawMode(false);
  } catch {
    // Not every stream can leave raw mode; that is not worth crashing over.
  }
  input.pause();
}

const SIGNAL_NUMBERS: Record<string, number> = { SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

function signalNumber(signal: NodeJS.Signals): number {
  return SIGNAL_NUMBERS[signal] ?? 0;
}
