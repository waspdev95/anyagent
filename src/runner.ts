/**
 * Executing a plan.
 *
 * Everything effectful lives here: locating the binary, backing up files,
 * writing them, spawning the agent. The split from `plan()` is what makes the
 * risky half of the tool - touching someone's config - small, linear and
 * reversible.
 */

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { AGENTS } from './agents/index.js';
import { AnyAgentError } from './errors.js';
import { buildCommand, commonBinPaths, run, which, type RunResult } from './exec.js';
import { ensureDir, pathExists, readJson, writeFileAtomic, writeJson } from './fsx.js';
import type { Paths } from './paths.js';
import type { Agent, LaunchPlan, PlanContext } from './types.js';

export interface RestoreEntry {
  file: string;
  /** Backup copy, absent when anyagent created the file. */
  backup?: string;
  at: string;
}

export interface RestoreManifest {
  version: 1;
  agents: Record<string, RestoreEntry[]>;
}

export interface Installed {
  path: string;
  version?: string;
}

/** Locate an agent's binary, searching PATH and the usual installer targets. */
export function locate(
  agent: Agent,
  home: string,
  platform = process.platform,
): string | undefined {
  const extraPaths = [
    ...(agent.extraPaths?.(home, platform) ?? []),
    ...commonBinPaths(home, platform),
  ];
  for (const name of agent.bin) {
    const found = which(name, { extraPaths, platform });
    if (found) return found;
  }
  return undefined;
}

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

interface VersionCacheEntry {
  version: string;
  /** Binary mtime, so an upgrade invalidates the entry. */
  mtimeMs: number;
}

/**
 * Ask an agent for its version, remembering the answer.
 *
 * Agents are heavy programs; `claude --version` alone costs seconds. Running it
 * on every launch would put that on the critical path of the one command people
 * type all day, so the result is cached against the binary's modification time
 * and only agents that actually need it (`versionArgs` declared) are asked.
 */
export async function detectVersion(
  agent: Agent,
  binary: string,
  cacheFile?: string,
): Promise<string | undefined> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fsp.stat(binary)).mtimeMs;
  } catch {
    return undefined;
  }

  const cache = cacheFile ? await readJson<Record<string, VersionCacheEntry>>(cacheFile, {}) : {};
  const cached = cache[binary];
  if (cached && cached.mtimeMs === mtimeMs) return cached.version;

  const version = await probeVersion(agent, binary);
  if (version && cacheFile) {
    cache[binary] = { version, mtimeMs };
    await writeJson(cacheFile, cache).catch(() => {});
  }
  return version;
}

function probeVersion(agent: Agent, binary: string): Promise<string | undefined> {
  const command = buildCommand(binary, agent.versionArgs ?? ['--version']);
  return new Promise<string | undefined>((resolve) => {
    const child = execFile(
      command.file,
      command.args,
      {
        timeout: 10_000,
        windowsHide: true,
        // buildCommand has already quoted the cmd.exe line; letting Node
        // re-escape it would break `.cmd` shims, which is most npm installs.
        windowsVerbatimArguments: command.viaShell && process.platform === 'win32',
      },
      (error, stdout) => {
        if (error && !stdout) return resolve(undefined);
        resolve(VERSION_PATTERN.exec(stdout)?.[0]);
      },
    );
    child.on('error', () => resolve(undefined));
  });
}

export interface ApplyOptions {
  paths: Paths;
  /** Print what would happen without writing or spawning. */
  dryRun?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Report progress; defaults to silence. */
  onFile?: (file: string, action: 'wrote' | 'backed up') => void;
}

/** Write a plan's files, backing up anything that already exists. */
export async function applyFiles(
  agent: Agent,
  plan: LaunchPlan,
  options: ApplyOptions,
): Promise<void> {
  if (plan.files.length === 0) return;

  const manifest = await readManifest(options.paths.restoreManifest);
  const entries = manifest.agents[agent.id] ?? [];
  const stamp = new Date().toISOString();

  for (const file of plan.files) {
    const exists = await pathExists(file.path);

    if (file.backup) {
      if (exists) {
        const backup = path.join(
          options.paths.backupsDir,
          agent.id,
          `${path.basename(file.path)}.${stamp.replace(/[:.]/g, '-')}.bak`,
        );
        await ensureDir(path.dirname(backup));
        await fsp.copyFile(file.path, backup);
        entries.push({ file: file.path, backup, at: stamp });
        options.onFile?.(file.path, 'backed up');
      } else {
        entries.push({ file: file.path, at: stamp });
      }
    }

    await writeFileAtomic(file.path, file.contents, file.mode);
    options.onFile?.(file.path, 'wrote');
  }

  if (entries.length > 0) {
    manifest.agents[agent.id] = entries;
    await writeJson(options.paths.restoreManifest, manifest);
  }
}

export async function readManifest(file: string): Promise<RestoreManifest> {
  return readJson<RestoreManifest>(file, { version: 1, agents: {} });
}

export interface RestoreResult {
  restored: string[];
  removed: string[];
  missing: string[];
}

/**
 * Undo the file changes anyagent made for one agent.
 *
 * For a file touched by several launches the *oldest* entry is the one that
 * matters: it holds the backup taken before anyagent first modified it, which
 * is the state the user actually wants back.
 */
export async function restoreAgent(agentId: string, paths: Paths): Promise<RestoreResult> {
  const manifest = await readManifest(paths.restoreManifest);
  const entries = manifest.agents[agentId];
  const result: RestoreResult = { restored: [], removed: [], missing: [] };
  if (!entries || entries.length === 0) return result;

  const handled = new Set<string>();
  for (const entry of entries) {
    if (handled.has(entry.file)) continue;
    handled.add(entry.file);

    if (!entry.backup) {
      if (await pathExists(entry.file)) {
        await fsp.rm(entry.file, { force: true });
        result.removed.push(entry.file);
      }
      continue;
    }

    if (!(await pathExists(entry.backup))) {
      result.missing.push(entry.file);
      continue;
    }
    await fsp.copyFile(entry.backup, entry.file);
    result.restored.push(entry.file);
  }

  delete manifest.agents[agentId];
  await writeJson(paths.restoreManifest, manifest);
  return result;
}

/** Agents that have pending changes on disk. */
export async function pendingRestores(paths: Paths): Promise<string[]> {
  const manifest = await readManifest(paths.restoreManifest);
  return Object.keys(manifest.agents).filter((id) => (manifest.agents[id]?.length ?? 0) > 0);
}

/** Spawn the agent described by a plan and wait for it to exit. */
export async function launch(
  plan: LaunchPlan,
  binary: string,
  options: ApplyOptions,
): Promise<RunResult> {
  const platform = options.platform ?? process.platform;
  const command = buildCommand(binary, plan.command.args, platform);
  const env = { ...(options.env ?? process.env), ...plan.env };
  return run(command, { env, cwd: options.cwd, platform });
}

/** The error shown when an agent is not installed. */
export function notInstalled(agent: Agent): AnyAgentError {
  const install = agent.install.command
    ? `Install it with:\n  ${agent.install.command.join(' ')}\n\n`
    : '';
  return new AnyAgentError(`${agent.name} is not installed.`, {
    hint: `${install}Documentation: ${agent.install.url}`,
    exitCode: 127,
  });
}

/** Read the files an agent needs in order to merge rather than overwrite. */
export async function readExisting(
  agent: Agent,
  context: Pick<PlanContext, 'home' | 'stateDir' | 'platform'>,
): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  for (const file of agent.reads?.(context) ?? []) {
    try {
      existing.set(file, await fsp.readFile(file, 'utf8'));
    } catch {
      // Missing is the common case on a first run; anything unreadable is
      // treated the same way and simply gets a fresh config.
    }
  }
  return existing;
}

/** Agents whose configuration anyagent has modified at some point. */
export function agentById(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}
