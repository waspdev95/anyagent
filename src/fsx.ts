import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
/**
 * Strip a UTF-8 BOM. PowerShell's `Set-Content`/`Out-File` add one by default,
 * which makes `JSON.parse` throw on config files that look perfectly fine in an
 * editor. Every JSON read in anyagent goes through here.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseJson<T = unknown>(text: string, source: string): T {
  try {
    return JSON.parse(stripBom(text)) as T;
  } catch (cause) {
    throw new Error(`${source} is not valid JSON: ${(cause as Error).message}`);
  }
}

/** Read and parse JSON, returning `fallback` when the file does not exist. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
  if (raw.trim() === '') return fallback;
  return parseJson<T>(raw, file);
}

export function readJsonSync<T>(file: string, fallback: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
  if (raw.trim() === '') return fallback;
  return parseJson<T>(raw, file);
}

/**
 * Write a file atomically: same-directory temp file, then rename. A crash or a
 * full disk can never leave a half-written config behind.
 */
export async function writeFileAtomic(
  file: string,
  contents: string,
  mode?: number,
): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fsp.writeFile(tmp, contents, mode === undefined ? 'utf8' : { encoding: 'utf8', mode });
    await fsp.rename(tmp, file);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  if (mode !== undefined) await restrict(file, mode);
}

export async function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restrict a file to the current user.
 *
 * POSIX gets `chmod`. Windows deliberately does nothing: it ignores POSIX modes,
 * and rewriting the ACL with `icacls /inheritance:r` is a good way to lock the
 * *owner* out of their own credentials when the account name does not resolve
 * the way the command expects. Files under the user profile already inherit an
 * ACL that excludes other standard users, so the safe move is to leave it alone
 * and tell the user where the file lives - which `anyagent doctor` does.
 */
export async function restrict(file: string, mode: number): Promise<void> {
  if (process.platform === 'win32') return;
  await fsp.chmod(file, mode).catch(() => {});
}

/** True when the file is readable by group or others (POSIX only). */
export async function isWorldReadable(file: string): Promise<boolean> {
  if (process.platform === 'win32') return false;
  try {
    const stat = await fsp.stat(file);
    return (stat.mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string, mode?: number): Promise<void> {
  await fsp.mkdir(dir, { recursive: true, ...(mode === undefined ? {} : { mode }) });
  if (mode !== undefined) await restrict(dir, mode);
}
