/**
 * Core type model.
 *
 * The central idea: launching an agent is a two-phase operation.
 *
 *   1. `plan()`  - pure. Given a resolved target (provider + model + key) it
 *                  returns the exact command, environment and files needed.
 *   2. `apply()` - effectful. Backs up, writes, spawns.
 *
 * Keeping phase 1 pure is what makes every integration testable without
 * touching the user's home directory or spawning a process.
 */

/** Wire protocol an endpoint speaks. */
export type Wire = 'anthropic' | 'openai-chat' | 'openai-responses';

export const WIRES: readonly Wire[] = ['anthropic', 'openai-chat', 'openai-responses'];

/** A model provider (OpenRouter, DeepSeek, a local Ollama, ...). */
export interface Provider {
  id: string;
  name: string;
  /** Docs / model list URL. */
  doc?: string;
  /** Where a user creates an API key. */
  console?: string;
  /** Provider-native env var names (e.g. OPENROUTER_API_KEY). */
  env: string[];
  /** Base URL per wire protocol. A provider may speak more than one. */
  baseUrl: Partial<Record<Wire, string>>;
  /** Extra HTTP headers agents should send (attribution, versioning). */
  headers?: Record<string, string>;
  /** Local endpoints need no credentials. */
  keyless?: boolean;
  /** Runs on the user's machine. */
  local?: boolean;
  /** Expected key prefix, used for a friendly validation warning only. */
  keyPrefix?: string;
}

/** A single model offered by a provider. */
export interface Model {
  id: string;
  name: string;
  contextLimit?: number;
  outputLimit?: number;
  toolCall?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  /** USD per 1M tokens. */
  cost?: { input?: number; output?: number };
}

/** Everything needed to point an agent somewhere. */
export interface Target {
  provider: Provider;
  wire: Wire;
  baseUrl: string;
  apiKey: string;
  model: Model;
  /** Cheap model for background tasks, where the agent supports a second tier. */
  smallModel?: Model;
}

/** A file an integration wants written before launch. */
export interface PlannedFile {
  path: string;
  contents: string;
  /** POSIX mode; ignored on Windows. */
  mode?: number;
  /** Back the existing file up and register it for `anyagent restore`. */
  backup?: boolean;
}

/** The complete, inspectable result of planning a launch. */
export interface LaunchPlan {
  /** Executable + argv. `file` is a binary name; resolution happens in exec.ts. */
  command: { file: string; args: string[] };
  /** Env vars added on top of the parent environment, for the child only. */
  env: Record<string, string>;
  /** Files to write (each optionally backed up). */
  files: PlannedFile[];
  /** Human-readable notes shown before launch. */
  notes: string[];
}

export interface PlanContext {
  target: Target;
  /**
   * Contents of the files listed by `Agent.reads`, keyed by absolute path.
   * The runner loads them before planning so that `plan()` can merge into an
   * existing config while staying free of I/O.
   */
  existing: Map<string, string>;
  /** Arguments the user wants forwarded verbatim to the agent. */
  passthrough: string[];
  /**
   * Version reported by the installed agent, when it could be determined.
   * Integrations use it to stay compatible with config schemas that change
   * between releases rather than guessing.
   */
  agentVersion?: string;
  /** Absolute paths, injected so tests never touch a real home directory. */
  home: string;
  /** Directory anyagent owns (`~/.anyagent` by default). */
  stateDir: string;
  /**
   * Current time as an ISO string, injected rather than read from the clock so
   * that planning is deterministic and golden tests stay stable.
   */
  now: string;
  platform: NodeJS.Platform;
}

export interface InstallSpec {
  /** Shell-agnostic install command, e.g. ['npm','install','-g','@openai/codex']. */
  command?: string[];
  /** Manual instructions URL. */
  url: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  homepage: string;
  /** Wire protocols this agent can be pointed at, best first. */
  wires: Wire[];
  /** Candidate executable names, first match wins. */
  bin: string[];
  /** Arguments that print the version. Defaults to `--version`. */
  versionArgs?: string[];
  /** Extra directories to search for the binary, beyond PATH. */
  extraPaths?: (home: string, platform: NodeJS.Platform) => string[];
  install: InstallSpec;
  /** Agent supports a separate cheap model tier. */
  supportsSmallModel?: boolean;
  /**
   * Files whose current contents `plan()` needs in order to merge rather than
   * overwrite. The runner reads them and passes them in `PlanContext.existing`.
   */
  reads?: (ctx: Pick<PlanContext, 'home' | 'stateDir' | 'platform'>) => string[];

  /** Build the launch plan. Pure: no I/O, no process spawning. */
  plan(ctx: PlanContext): LaunchPlan;
  /**
   * Files this integration owns, for `anyagent restore`. Restoring reverts
   * these from the newest backup, or deletes them if anyagent created them.
   */
  ownedFiles?: (ctx: Pick<PlanContext, 'home' | 'stateDir' | 'platform'>) => string[];
}
