/**
 * Argument parsing.
 *
 * Two rules make the CLI feel invisible:
 *
 *   1. anyagent owns a small, fixed set of flags. Anything it does not
 *      recognise is forwarded to the agent verbatim, so `anyagent claude
 *      --resume` just works without ceremony.
 *   2. `--` still exists as an explicit escape hatch for the rare case where
 *      an agent flag collides with one of ours.
 */

export type FlagType = 'string' | 'boolean';

export interface FlagSpec {
  type: FlagType;
  /** Single-character alias, without the dash. */
  short?: string;
  /** Default value when the flag is absent. */
  default?: string | boolean;
  description: string;
  /** Placeholder shown in help, e.g. `<model>`. */
  value?: string;
}

export type FlagSpecs = Record<string, FlagSpec>;

export interface ParseResult {
  flags: Record<string, string | boolean | undefined>;
  positionals: string[];
  /** Tokens destined for the child process, in original order. */
  passthrough: string[];
  /** Flags we did not recognise, kept for a "did you mean" hint. */
  unknown: string[];
}

export interface ParseOptions {
  /** Forward unrecognised tokens instead of failing. */
  forwardUnknown?: boolean;
  /** Stop owning arguments after this many positionals. */
  maxPositionals?: number;
}

export function parseArgs(
  argv: string[],
  specs: FlagSpecs,
  options: ParseOptions = {},
): ParseResult {
  const forwardUnknown = options.forwardUnknown ?? false;
  const shorts = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short) shorts.set(spec.short, name);
  }

  const flags: Record<string, string | boolean | undefined> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.default !== undefined) flags[name] = spec.default;
  }

  const positionals: string[] = [];
  const passthrough: string[] = [];
  const unknown: string[] = [];
  let terminated = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (terminated) {
      passthrough.push(token);
      continue;
    }

    if (token === '--') {
      terminated = true;
      continue;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);

      const negated = name.startsWith('no-') ? name.slice(3) : undefined;
      const spec = specs[name] ?? (negated ? specs[negated] : undefined);

      if (!spec) {
        if (!forwardUnknown) throw new UnknownFlagError(token, Object.keys(specs));
        unknown.push(token);
        passthrough.push(token);
        continue;
      }

      if (negated && specs[negated]) {
        flags[negated] = false;
        continue;
      }

      if (spec.type === 'boolean') {
        flags[name] = inlineValue === undefined ? true : inlineValue !== 'false';
        continue;
      }

      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next === '--') {
        throw new MissingValueError(`--${name}`, spec);
      }
      flags[name] = next;
      index += 1;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      // Short flags: -m value, -m=value, and clustered booleans like -yv.
      const body = token.slice(1);
      const eq = body.indexOf('=');
      const cluster = eq === -1 ? body : body.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);
      let consumedNext = false;
      let forwarded = false;

      for (let position = 0; position < cluster.length; position += 1) {
        const letter = cluster[position]!;
        const name = shorts.get(letter);
        const spec = name ? specs[name] : undefined;
        if (!name || !spec) {
          if (!forwardUnknown) throw new UnknownFlagError(`-${letter}`, Object.keys(specs));
          unknown.push(token);
          passthrough.push(token);
          forwarded = true;
          break;
        }
        if (spec.type === 'boolean') {
          flags[name] = true;
          continue;
        }
        // A value flag consumes the rest of the cluster, then `=value`, then the next token.
        const rest = cluster.slice(position + 1);
        if (rest) {
          flags[name] = inlineValue === undefined ? rest : `${rest}=${inlineValue}`;
        } else if (inlineValue !== undefined) {
          flags[name] = inlineValue;
        } else {
          const next = argv[index + 1];
          if (next === undefined || next === '--') throw new MissingValueError(`-${letter}`, spec);
          flags[name] = next;
          consumedNext = true;
        }
        break;
      }

      if (forwarded) continue;
      if (consumedNext) index += 1;
      continue;
    }

    if (options.maxPositionals !== undefined && positionals.length >= options.maxPositionals) {
      if (!forwardUnknown) throw new UnknownFlagError(token, Object.keys(specs));
      passthrough.push(token);
      continue;
    }
    positionals.push(token);
  }

  return { flags, positionals, passthrough, unknown };
}

export class UnknownFlagError extends Error {
  readonly flag: string;
  readonly suggestion?: string;

  constructor(flag: string, known: string[]) {
    const suggestion = closest(flag.replace(/^-+/, ''), known);
    super(
      suggestion
        ? `Unknown option ${flag}. Did you mean --${suggestion}?`
        : `Unknown option ${flag}.`,
    );
    this.name = 'UnknownFlagError';
    this.flag = flag;
    this.suggestion = suggestion;
  }
}

export class MissingValueError extends Error {
  constructor(flag: string, spec: FlagSpec) {
    super(`Option ${flag} needs a value${spec.value ? `, e.g. ${flag} ${spec.value}` : ''}.`);
    this.name = 'MissingValueError';
  }
}

/** Levenshtein distance, capped at a useful suggestion threshold. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

/** Nearest match within an edit distance that still reads as a typo. */
export function closest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  const limit = input.length <= 4 ? 1 : input.length <= 8 ? 2 : 3;
  for (const candidate of candidates) {
    const score = distance(input.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= limit ? best : undefined;
}
