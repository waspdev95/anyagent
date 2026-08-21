import type { Agent, Wire } from '../types.js';
import { claude } from './claude.js';
import { cline } from './cline.js';
import { codex } from './codex.js';
import { droid } from './droid.js';
import { dsh } from './dsh.js';
import { ENV_AGENTS } from './env-only.js';
import { hermes } from './hermes.js';
import { openclaw } from './openclaw.js';
import { opencode } from './opencode.js';
import { pi } from './pi.js';

/**
 * The agent registry.
 *
 * Order is the order shown by `anyagent ls`: the agents most people arrive
 * looking for come first.
 */
export const AGENTS: Agent[] = [
  claude,
  codex,
  opencode,
  ...ENV_AGENTS.filter((agent) => agent.id === 'copilot'),
  droid,
  dsh,
  pi,
  openclaw,
  hermes,
  cline,
  ...ENV_AGENTS.filter((agent) => agent.id !== 'copilot'),
];

const BY_NAME = new Map<string, Agent>();
for (const agent of AGENTS) {
  BY_NAME.set(agent.id, agent);
  for (const alias of agent.aliases ?? []) BY_NAME.set(alias, agent);
}

export function findAgent(name: string): Agent | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

export function agentIds(): string[] {
  return AGENTS.map((agent) => agent.id);
}

/** Every id and alias, for shell completion and "did you mean" suggestions. */
export function agentNames(): string[] {
  return [...BY_NAME.keys()].sort();
}

/** Agents that can be driven over a given wire protocol. */
export function agentsForWire(wire: Wire): Agent[] {
  return AGENTS.filter((agent) => agent.wires.includes(wire));
}

export { claude, codex, opencode, droid, dsh, pi, openclaw, hermes, cline };
export * from './env-only.js';
