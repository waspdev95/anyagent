import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The npm package name. The command is `anyagent`; the package is scoped. */
const PACKAGE_NAME = '@anyagent/cli';

/**
 * The published version, read from package.json rather than duplicated in a
 * source file that would drift.
 *
 * The lookup walks up from this module so it works from `src/` when running
 * from source, from `dist/` when installed, and from a compiled test tree -
 * all of which sit at different depths relative to the package root.
 */
function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === PACKAGE_NAME && parsed.version) return parsed.version;
      } catch {
        // Keep walking: an unrelated, unreadable package.json is not fatal.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0-dev';
}

export const VERSION: string = readVersion();
