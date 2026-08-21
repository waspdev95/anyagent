/**
 * A user-facing error. Every failure the CLI prints goes through here so that
 * messages stay consistent: what went wrong, then what to do about it.
 */
export class AnyAgentError extends Error {
  readonly hint?: string;
  readonly exitCode: number;

  constructor(
    message: string,
    options: { hint?: string; exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AnyAgentError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

/** Raised when the user aborts an interactive prompt. */
export class CancelledError extends AnyAgentError {
  constructor() {
    super('Cancelled.', { exitCode: 130 });
    this.name = 'CancelledError';
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[a-zA-Z0-9-]{2,}-)[a-zA-Z0-9_-]{8,}/g,
  /\b(gsk_|xai-|csk-|tgp_v1_|fw_|nvapi-|ghp_|gho_)[a-zA-Z0-9_-]{8,}/g,
  /\b([a-f0-9]{8})[a-f0-9]{24,}\.[a-zA-Z0-9_-]{8,}/g,
];

/**
 * Strip anything that looks like a credential out of text before printing it.
 * Errors from HTTP clients love to echo request headers back.
 */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_m, prefix: string) => `${prefix}...redacted`);
  }
  return out;
}

/** Show enough of a key to be recognisable, never enough to be usable. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '*'.repeat(Math.max(trimmed.length, 4));
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}
