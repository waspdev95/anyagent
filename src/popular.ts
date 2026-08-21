/**
 * Which providers to show first.
 *
 * The catalog is 183 entries in alphabetical order, which means the first thing
 * anyone sees is `302ai, abacus, abliteration-ai`. That is a terrible answer to
 * "where should I get a model from", and it is the same problem whether the list
 * appears in a picker, in `anyagent providers`, or in the suggestions attached to
 * an error.
 *
 * So there is one ranking, used everywhere: providers you already have a key
 * for, then the ones most people actually reach for, then everything else
 * alphabetically. It is a curated opinion, and being useful is worth more here
 * than being neutral.
 */

import type { Provider } from './types.js';

export const POPULAR_PROVIDERS: readonly string[] = [
  'openrouter',
  'deepseek',
  'zai',
  'moonshotai',
  'groq',
  'cerebras',
  'togetherai',
  'fireworks-ai',
  'xai',
  'minimax',
  'openai',
  'anthropic',
  'google',
  'mistral',
  'siliconflow',
  'novita-ai',
  'ollama',
  'lmstudio',
];

/** Lower sorts earlier. */
export function providerRank(id: string, configured?: ReadonlySet<string>): number {
  if (configured?.has(id)) return -1000;
  const index = POPULAR_PROVIDERS.indexOf(id);
  return index === -1 ? 1000 : index;
}

/** Sort a provider list into the order people find useful. */
export function byPopularity(
  providers: readonly Provider[],
  configured?: ReadonlySet<string>,
): Provider[] {
  return [...providers].sort((a, b) => {
    const rank = providerRank(a.id, configured) - providerRank(b.id, configured);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });
}
