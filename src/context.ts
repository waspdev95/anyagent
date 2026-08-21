/**
 * Per-invocation context.
 *
 * Commands receive this instead of reaching for `process` or `os` directly,
 * which is what lets the test suite run the real command implementations
 * against a temporary home directory and a stub catalog.
 */

import { homedir } from 'node:os';

import { loadCatalog, type Catalog } from './catalog.js';
import { loadProjectConfig, loadUserConfig, type UserConfig } from './config.js';
import { createStore, type SecretStore } from './credentials.js';
import { resolvePaths, type Paths } from './paths.js';

export interface Cli {
  paths: Paths;
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  config: UserConfig;
  project: { file?: string; config: UserConfig };
  store: SecretStore;
  /** Machine-readable output requested with --json. */
  json: boolean;
  /** Skip prompts and accept defaults. */
  yes: boolean;
  /** Load the catalog once per invocation. */
  catalog(options?: { refresh?: boolean; force?: boolean }): Promise<Catalog>;
}

export interface CreateCliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  platform?: NodeJS.Platform;
  json?: boolean;
  yes?: boolean;
}

export async function createCli(options: CreateCliOptions = {}): Promise<Cli> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const paths = resolvePaths(env, home);
  const config = await loadUserConfig(paths.config);
  const project = await loadProjectConfig(cwd);

  let catalogPromise: Promise<Catalog> | undefined;

  // An explicit offline switch, for air-gapped machines, CI and the test
  // suite. Without it a stale cache would silently reach for the network.
  const offline = Boolean(env.ANYAGENT_CATALOG_OFFLINE?.trim());

  return {
    paths,
    env,
    cwd,
    home,
    platform: options.platform ?? process.platform,
    config,
    project,
    store: createStore(config.credentialStore ?? 'file', paths.credentials, options.platform),
    json: options.json ?? false,
    yes: options.yes ?? false,
    catalog(catalogOptions = {}) {
      if (offline) {
        catalogPromise ??= loadCatalog({ cacheFile: paths.catalogCache, refresh: false });
        return catalogPromise;
      }
      if (catalogOptions.force || (catalogOptions.refresh && !catalogPromise)) {
        catalogPromise = loadCatalog({
          cacheFile: paths.catalogCache,
          refresh: true,
          force: catalogOptions.force ?? false,
        });
        return catalogPromise;
      }
      catalogPromise ??= loadCatalog({
        cacheFile: paths.catalogCache,
        refresh: config.autoRefreshCatalog !== false,
      });
      return catalogPromise;
    },
  };
}
