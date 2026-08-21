import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Filesystem layout. Every path anyagent touches is derived here so tests can
 * redirect the whole tree with one environment variable.
 *
 *   ANYAGENT_HOME  overrides the state directory outright
 *   XDG_CONFIG_HOME is honoured on Linux/macOS when set
 */
export interface Paths {
  /** User home. */
  home: string;
  /** anyagent's own directory. */
  state: string;
  config: string;
  credentials: string;
  cacheDir: string;
  catalogCache: string;
  versionCache: string;
  backupsDir: string;
  restoreManifest: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): Paths {
  const state = stateDir(env, home);
  return {
    home,
    state,
    config: path.join(state, 'config.json'),
    credentials: path.join(state, 'credentials.json'),
    cacheDir: path.join(state, 'cache'),
    catalogCache: path.join(state, 'cache', 'catalog.json'),
    versionCache: path.join(state, 'cache', 'versions.json'),
    backupsDir: path.join(state, 'backups'),
    restoreManifest: path.join(state, 'backups', 'manifest.json'),
  };
}

function stateDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.ANYAGENT_HOME?.trim();
  if (override) return path.resolve(override);

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg && process.platform !== 'win32') return path.join(path.resolve(xdg), 'anyagent');

  return path.join(home, '.anyagent');
}

/** Per-project overrides, discovered by walking up from `cwd`. */
export const PROJECT_CONFIG_NAMES = ['.anyagent.json', '.anyagent/config.json'] as const;
