/**
 * API key storage.
 *
 * Keys are resolved from the least surprising source first, so a CI job that
 * exports `OPENROUTER_API_KEY` needs no anyagent configuration at all:
 *
 *   1. --api-key on the command line (used once, never written to disk)
 *   2. ANYAGENT_<PROVIDER>_API_KEY
 *   3. the provider's own env var (OPENROUTER_API_KEY, GROQ_API_KEY, ...)
 *   4. the credential store
 *
 * The default store is a 0600 file. On Windows, where POSIX modes are inert,
 * the file is additionally locked to the current account with `icacls`. An
 * opt-in keychain store hands the secret to the OS instead: Keychain on macOS,
 * libsecret on Linux, DPAPI on Windows.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readJson, writeJson, isWorldReadable } from './fsx.js';
import type { Provider } from './types.js';

const execFileAsync = promisify(execFile);

export const KEYCHAIN_SERVICE = 'anyagent';

export type StoreKind = 'file' | 'keychain';

export interface CredentialSource {
  key: string;
  /** Human-readable origin, shown by `anyagent auth list`. */
  origin: string;
  /** True when the value came from the environment rather than our store. */
  ephemeral: boolean;
}

export interface CredentialFile {
  version: 1;
  keys: Record<string, string>;
}

export interface SecretStore {
  kind: StoreKind;
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, key: string): Promise<void>;
  delete(providerId: string): Promise<boolean>;
  list(): Promise<string[]>;
  /** A short description of where secrets live, for `doctor`. */
  location(): string;
}

/** `ANYAGENT_OPENROUTER_API_KEY` from `openrouter`. */
export function envVarNameFor(providerId: string): string {
  return `ANYAGENT_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

/** Resolve a key without prompting. Returns undefined when nothing is set. */
export async function resolveKey(
  provider: Provider,
  store: SecretStore,
  env: NodeJS.ProcessEnv = process.env,
  override?: string,
): Promise<CredentialSource | undefined> {
  if (override?.trim()) {
    return { key: override.trim(), origin: '--api-key', ephemeral: true };
  }

  const scoped = env[envVarNameFor(provider.id)];
  if (scoped?.trim()) {
    return { key: scoped.trim(), origin: envVarNameFor(provider.id), ephemeral: true };
  }

  for (const name of provider.env) {
    const value = env[name];
    if (value?.trim()) return { key: value.trim(), origin: name, ephemeral: true };
  }

  const stored = await store.get(provider.id);
  if (stored?.trim()) {
    return { key: stored.trim(), origin: store.location(), ephemeral: false };
  }

  if (provider.keyless) {
    return { key: 'anyagent', origin: 'not required (local provider)', ephemeral: true };
  }

  return undefined;
}

/** Store backed by a permission-restricted JSON file. */
export class FileStore implements SecretStore {
  readonly kind = 'file' as const;

  constructor(private readonly file: string) {}

  async get(providerId: string): Promise<string | undefined> {
    const data = await this.read();
    return data.keys[providerId];
  }

  async set(providerId: string, key: string): Promise<void> {
    const data = await this.read();
    data.keys[providerId] = key;
    await writeJson(this.file, data, 0o600);
  }

  async delete(providerId: string): Promise<boolean> {
    const data = await this.read();
    if (!(providerId in data.keys)) return false;
    delete data.keys[providerId];
    await writeJson(this.file, data, 0o600);
    return true;
  }

  async list(): Promise<string[]> {
    return Object.keys((await this.read()).keys).sort();
  }

  location(): string {
    return this.file;
  }

  /** True when other users on the machine can read the file. */
  async isExposed(): Promise<boolean> {
    return isWorldReadable(this.file);
  }

  private async read(): Promise<CredentialFile> {
    return readJson<CredentialFile>(this.file, { version: 1, keys: {} });
  }
}

/**
 * Store backed by the operating system.
 *
 * Windows has no secret daemon, so DPAPI is used instead: the ciphertext is
 * bound to the current user account and kept in the same JSON file. Decryption
 * on another account, or another machine, simply fails.
 */
export class KeychainStore implements SecretStore {
  readonly kind = 'keychain' as const;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly fallback?: FileStore,
  ) {}

  async get(providerId: string): Promise<string | undefined> {
    try {
      switch (this.platform) {
        case 'darwin': {
          const { stdout } = await execFileAsync('security', [
            'find-generic-password',
            '-s',
            KEYCHAIN_SERVICE,
            '-a',
            providerId,
            '-w',
          ]);
          return stdout.trim() || undefined;
        }
        case 'win32': {
          const encrypted = await this.fallback?.get(providerId);
          return encrypted ? await dpapiDecrypt(encrypted) : undefined;
        }
        default: {
          const { stdout } = await execFileAsync('secret-tool', [
            'lookup',
            'service',
            KEYCHAIN_SERVICE,
            'account',
            providerId,
          ]);
          return stdout.trim() || undefined;
        }
      }
    } catch {
      return undefined;
    }
  }

  async set(providerId: string, key: string): Promise<void> {
    switch (this.platform) {
      case 'darwin':
        await execFileAsync('security', [
          'add-generic-password',
          '-s',
          KEYCHAIN_SERVICE,
          '-a',
          providerId,
          '-w',
          key,
          '-U',
        ]);
        return;
      case 'win32': {
        if (!this.fallback) throw new Error('DPAPI store needs a backing file');
        await this.fallback.set(providerId, await dpapiEncrypt(key));
        return;
      }
      default:
        await runWithInput(
          'secret-tool',
          ['store', '--label=anyagent', 'service', KEYCHAIN_SERVICE, 'account', providerId],
          key,
        );
    }
  }

  async delete(providerId: string): Promise<boolean> {
    try {
      switch (this.platform) {
        case 'darwin':
          await execFileAsync('security', [
            'delete-generic-password',
            '-s',
            KEYCHAIN_SERVICE,
            '-a',
            providerId,
          ]);
          return true;
        case 'win32':
          return (await this.fallback?.delete(providerId)) ?? false;
        default:
          await execFileAsync('secret-tool', [
            'clear',
            'service',
            KEYCHAIN_SERVICE,
            'account',
            providerId,
          ]);
          return true;
      }
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    // Neither Keychain nor libsecret enumerate cheaply by service; the file
    // index doubles as the list of accounts we have written.
    return (await this.fallback?.list()) ?? [];
  }

  location(): string {
    switch (this.platform) {
      case 'darwin':
        return 'macOS Keychain';
      case 'win32':
        return 'Windows DPAPI';
      default:
        return 'libsecret (secret-tool)';
    }
  }
}

/**
 * Run a command with a secret on stdin.
 *
 * The secret never appears in an argument vector, so it cannot leak through
 * the process list - which is exactly why DPAPI is driven this way rather than
 * with `-Command "... '$key' ..."`.
 */
async function runWithInput(file: string, args: string[], input: string): Promise<string> {
  const child = execFile(file, args, { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdin?.end(`${input}\n`);
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${file} exited with ${code}`)),
    );
  });
  return stdout.trim();
}

const DPAPI_ENCRYPT =
  '$input | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString';

const DPAPI_DECRYPT =
  '$secure = $input | ConvertTo-SecureString; ' +
  '[Runtime.InteropServices.Marshal]::PtrToStringAuto(' +
  '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))';

async function dpapiEncrypt(value: string): Promise<string> {
  return runWithInput(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', DPAPI_ENCRYPT],
    value,
  );
}

async function dpapiDecrypt(encrypted: string): Promise<string> {
  return runWithInput(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', DPAPI_DECRYPT],
    encrypted,
  );
}

export function createStore(
  kind: StoreKind,
  file: string,
  platform = process.platform,
): SecretStore {
  const fileStore = new FileStore(file);
  return kind === 'keychain' ? new KeychainStore(platform, fileStore) : fileStore;
}

/** A cheap sanity check so a pasted-wrong key fails before an agent starts. */
export function keyLooksWrong(provider: Provider, key: string): string | undefined {
  if (!key.trim()) return 'The key is empty.';
  if (/\s/.test(key.trim())) return 'The key contains whitespace - check for a partial paste.';
  if (provider.keyPrefix && !key.startsWith(provider.keyPrefix)) {
    return `${provider.name} keys usually start with "${provider.keyPrefix}".`;
  }
  return undefined;
}
