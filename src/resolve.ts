/**
 * Turning user input into a concrete Target.
 *
 * Three questions have to be answered before an agent can start, and each one
 * has a failure mode worth a good error message:
 *
 *   which provider   - is it known, and does it have a usable endpoint?
 *   which protocol   - can this agent and this provider actually talk?
 *   which model      - does the provider offer it, and if not, what is close?
 */

import { closest } from './args.js';
import { findProvider, normalizeBase, providerModels, providersForWire } from './catalog.js';
import type { Catalog } from './catalog.js';
import { AnyAgentError } from './errors.js';
import { byPopularity } from './popular.js';
import type { Agent, Model, Provider, Target, Wire } from './types.js';

export const WIRE_LABELS: Record<Wire, string> = {
  anthropic: 'Anthropic Messages',
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

/** Pick the best protocol both sides support, following the agent's preference. */
export function negotiateWire(agent: Agent, provider: Provider): Wire | undefined {
  return agent.wires.find((wire) => provider.baseUrl[wire]);
}

export function resolveProvider(catalog: Catalog, id: string | undefined): Provider {
  if (!id) {
    throw new AnyAgentError('No provider selected.', {
      hint: 'Run `anyagent auth add <provider>` once, or pass --provider <id>.\nSee `anyagent providers` for the list.',
    });
  }

  const provider = findProvider(catalog, id);
  if (provider) return provider;

  const unsupported = catalog.unsupported.get(id);
  if (unsupported) {
    throw new AnyAgentError(`Provider "${id}" cannot be used by anyagent.`, { hint: unsupported });
  }

  const suggestion = closest(
    id,
    catalog.providers.map((candidate) => candidate.id),
  );
  throw new AnyAgentError(`Unknown provider "${id}".`, {
    hint: suggestion
      ? `Did you mean "${suggestion}"? Run \`anyagent providers ${id}\` to search.`
      : `Run \`anyagent providers ${id}\` to search the catalog.`,
  });
}

/**
 * Resolve a model id against a provider's catalog.
 *
 * Exact match wins, then case-insensitive, then a unique suffix match so
 * `deepseek-chat` finds `deepseek/deepseek-chat`. Providers with an empty
 * catalog (a local Ollama, a custom endpoint) accept any id as-is, because the
 * only authority on what they serve is the server itself.
 */
export function resolveModel(catalog: Catalog, provider: Provider, id: string | undefined): Model {
  if (!id) {
    throw new AnyAgentError(`No model selected for ${provider.name}.`, {
      hint: `Pass --model <id>, or set a default with \`anyagent use ${provider.id}/<model>\`.\nSearch with \`anyagent models --provider ${provider.id}\`.`,
    });
  }

  const models = providerModels(catalog, provider.id);
  if (models.length === 0) {
    return { id, name: id };
  }

  const exact = models.find((model) => model.id === id);
  if (exact) return exact;

  const insensitive = models.find((model) => model.id.toLowerCase() === id.toLowerCase());
  if (insensitive) return insensitive;

  const suffix = models.filter((model) => model.id.toLowerCase().endsWith(`/${id.toLowerCase()}`));
  if (suffix.length === 1) return suffix[0]!;

  const contains = models
    .filter((model) => model.id.toLowerCase().includes(id.toLowerCase()))
    .slice(0, 8);
  const suggestion =
    contains.length > 0
      ? contains.map((model) => `  ${model.id}`).join('\n')
      : (closest(
          id,
          models.map((model) => model.id),
        ) ?? '');

  throw new AnyAgentError(`${provider.name} does not list a model called "${id}".`, {
    hint: suggestion
      ? `Close matches:\n${suggestion}\n\nSearch with \`anyagent models ${id} --provider ${provider.id}\`.`
      : `Search with \`anyagent models --provider ${provider.id}\`.`,
  });
}

/**
 * Split `provider:model` when the prefix is unambiguously a provider id.
 *
 * The check is deliberately conservative: `llama3:8b` is an Ollama tag, not a
 * provider called `llama3`, so a prefix only counts when it names a real
 * provider *and* the whole string is not itself a known model.
 */
export function splitQualifiedModel(
  catalog: Catalog,
  value: string,
  currentProvider?: Provider,
): { provider?: string; model: string } {
  const separator = value.indexOf(':');
  if (separator <= 0) return { model: value };

  const prefix = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (!rest) return { model: value };

  if (currentProvider) {
    const known = providerModels(catalog, currentProvider.id);
    if (known.some((model) => model.id === value)) return { model: value };
  }

  return findProvider(catalog, prefix) ? { provider: prefix, model: rest } : { model: value };
}

export interface TargetInput {
  agent: Agent;
  catalog: Catalog;
  providerId?: string;
  modelId?: string;
  smallModelId?: string;
  baseUrlOverride?: string;
  apiKey: string;
}

export function buildTarget(input: TargetInput): Target {
  const provider = resolveProvider(input.catalog, input.providerId);
  const wire = negotiateWire(input.agent, provider);

  if (!wire) {
    throw incompatible(input.agent, provider, input.catalog);
  }

  const baseUrl = input.baseUrlOverride
    ? normalizeBase(input.baseUrlOverride)
    : provider.baseUrl[wire]!;

  const target: Target = {
    provider,
    wire,
    baseUrl,
    apiKey: input.apiKey,
    model: resolveModel(input.catalog, provider, input.modelId),
  };

  if (input.smallModelId && input.agent.supportsSmallModel) {
    target.smallModel = resolveModel(input.catalog, provider, input.smallModelId);
  }
  return target;
}

/**
 * The error that explains why an agent and a provider cannot be paired.
 *
 * The first two lines are deliberately free of protocol names: someone hitting
 * this wants to know what to do, not what an API dialect is called. The
 * technical detail comes last, for the person who does want it.
 */
export function incompatible(agent: Agent, provider: Provider, catalog: Catalog): AnyAgentError {
  const alternatives = byPopularity(
    providersForWire(catalog, agent.wires[0]!).filter((candidate) => !candidate.local),
  )
    .slice(0, 5)
    .map((candidate) => candidate.id);

  const needs = agent.wires.map((wire) => WIRE_LABELS[wire]).join(' or ');
  const speaks = Object.keys(provider.baseUrl)
    .map((wire) => WIRE_LABELS[wire as Wire])
    .join(', ');

  const lines = [`${provider.name} does not offer the kind of API that ${agent.name} needs.`, ''];
  if (alternatives.length > 0) {
    lines.push(`Try one of these instead: ${alternatives.join(', ')}`);
    lines.push(`  anyagent ${agent.id} --provider ${alternatives[0]}`);
    lines.push('');
  }
  const providersHint = `  anyagent providers --agent ${agent.id}`;
  lines.push(`${providersHint}   everything that works`);
  lines.push(
    `  anyagent compat --why${' '.repeat(Math.max(1, providersHint.length - 23))}   the technical reason`,
  );
  lines.push('');
  lines.push(
    `(${agent.name} needs ${needs}; ${provider.name} offers ${speaks || 'no compatible API'}.)`,
  );

  return new AnyAgentError(`${agent.name} cannot use ${provider.name}.`, {
    hint: lines.join('\n'),
  });
}
