/**
 * Tiny TOML and YAML writers.
 *
 * Two integrations need non-JSON config (Codex speaks TOML, DeepSeek Harness
 * speaks YAML). Both files are written by anyagent from a known shape and never
 * parsed back, so a full library would be 200 KB of dependency for a job that
 * is a hundred lines - and a dependency in the credential path is a dependency
 * worth not having.
 */

export type Scalar = string | number | boolean;
export type Value = Scalar | Value[] | { [key: string]: Value };

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : tomlString(key);
}

export function tomlValue(value: Value): string {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  const inline = Object.entries(value).map(([key, item]) => `${tomlKey(key)} = ${tomlValue(item)}`);
  return `{ ${inline.join(', ')} }`;
}

export interface TomlTable {
  /** Dotted table header, e.g. `model_providers.anyagent`. Empty means root. */
  header?: string;
  values: Record<string, Value>;
}

/** Render root keys followed by `[table]` sections, in the order given. */
export function toToml(tables: TomlTable[]): string {
  const chunks: string[] = [];
  for (const table of tables) {
    const lines: string[] = [];
    if (table.header) lines.push(`[${table.header}]`);
    for (const [key, value] of Object.entries(table.values)) {
      if (value === undefined) continue;
      lines.push(`${tomlKey(key)} = ${tomlValue(value)}`);
    }
    if (lines.length > 0) chunks.push(lines.join('\n'));
  }
  return `${chunks.join('\n\n')}\n`;
}

/**
 * Render a YAML document. Strings are always quoted, which is verbose but
 * removes every ambiguity around `yes`, `no`, `on`, version-like values and
 * leading zeroes.
 */
export function toYaml(value: Value, indent = 0): string {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (isRecord(item) || Array.isArray(item)) {
          const nested = toYaml(item, indent + 2);
          return `${pad}-\n${nested}`;
        }
        return `${pad}- ${yamlScalar(item)}\n`;
      })
      .join('');
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([key, item]) => {
        if (isRecord(item) && Object.keys(item).length === 0) return `${pad}${key}: {}\n`;
        if (Array.isArray(item) && item.length === 0) return `${pad}${key}: []\n`;
        if (isRecord(item) || Array.isArray(item)) {
          return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
        }
        return `${pad}${key}: ${yamlScalar(item)}\n`;
      })
      .join('');
  }

  return `${pad}${yamlScalar(value)}\n`;
}

function yamlScalar(value: Scalar): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
