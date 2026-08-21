/**
 * Helpers shared by the agent integrations.
 */

import path from 'node:path';

import { parseJson } from '../fsx.js';
import type { PlanContext, Target } from '../types.js';

/**
 * The id anyagent uses for the provider entries it writes into agent configs.
 *
 * A dedicated namespace is what makes `anyagent restore` precise: entries under
 * this key are ours to rewrite or remove, everything else is the user's and is
 * preserved untouched.
 */
export const MANAGED_ID = 'anyagent';

/** Marker written into managed model entries so we can recognise them later. */
export const MANAGED_MARKER = '_anyagent';

export type Json = Record<string, unknown>;

/** Read one of the files the runner pre-loaded, or an empty object. */
export function existingJson(ctx: PlanContext, file: string): Json {
  const raw = ctx.existing.get(file);
  if (raw === undefined || raw.trim() === '') return {};
  const parsed = parseJson<unknown>(raw, file);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Json)
    : {};
}

/** Navigate to a nested object, creating plain objects along the way. */
export function section(root: Json, ...keys: string[]): Json {
  let node = root;
  for (const key of keys) {
    const child = node[key];
    node[key] = typeof child === 'object' && child !== null && !Array.isArray(child) ? child : {};
    node = node[key] as Json;
  }
  return node;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Serialise config JSON the way the agents' own tooling writes it. */
export function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The model entry most OpenAI-compatible agent configs expect.
 * Fields the catalog does not know about are left out rather than guessed.
 */
export function modelEntry(target: Target): Json {
  const entry: Json = {
    id: target.model.id,
    name: target.model.name || target.model.id,
    [MANAGED_MARKER]: true,
  };
  if (target.model.contextLimit) entry.contextWindow = target.model.contextLimit;
  if (target.model.outputLimit) entry.maxTokens = target.model.outputLimit;
  entry.input = target.model.attachment ? ['text', 'image'] : ['text'];
  if (target.model.reasoning) entry.reasoning = true;
  return entry;
}

/** True when a config entry was written by anyagent. */
export function isManaged(entry: unknown): boolean {
  return typeof entry === 'object' && entry !== null && (entry as Json)[MANAGED_MARKER] === true;
}

/** Home directory of an agent, honouring an env override when it has one. */
export function agentHome(ctx: Pick<PlanContext, 'home'>, ...segments: string[]): string {
  return path.join(ctx.home, ...segments);
}

/** A directory anyagent owns for a specific agent. */
export function managedDir(ctx: Pick<PlanContext, 'stateDir'>, agentId: string): string {
  return path.join(ctx.stateDir, 'agents', agentId);
}

/**
 * Header list in the `Name: Value` form several agents accept.
 * Returns undefined when the provider asks for no extra headers.
 */
export function headerLines(target: Target): string | undefined {
  const headers = target.provider.headers;
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}
