/**
 * Curated corrections layered on top of the models.dev catalog.
 *
 * models.dev is excellent at breadth - 190+ providers with model ids, context
 * windows and pricing - but it describes providers through the lens of the
 * Vercel AI SDK. Two things it cannot tell us are exactly what agents need:
 *
 *   1. The base URL for providers whose SDK hard-codes it (`api` is absent).
 *   2. Which providers expose an *Anthropic-compatible* Messages endpoint,
 *      which is the only way to point Claude Code at a non-Anthropic model.
 *
 * `anthropicSource` records how each Anthropic endpoint was established:
 *   'probe' - the route was confirmed to exist (auth error, while a sibling
 *             bogus route on the same host returns 404)
 *   'docs'  - published by the provider; the host answers auth before routing
 *             so a probe cannot distinguish it
 */

import type { Provider, Wire } from '../types.js';

export interface ProviderOverlay {
  name?: string;
  baseUrl?: Partial<Record<Wire, string>>;
  headers?: Record<string, string>;
  console?: string;
  keyPrefix?: string;
  keyless?: boolean;
  local?: boolean;
  env?: string[];
  /** Needs cloud credentials (SigV4, ADC, ...) that a base URL cannot express. */
  unsupported?: string;
  anthropicSource?: 'probe' | 'docs';
  /** How the OpenAI Responses endpoint was established. Codex requires it. */
  responsesSource?: 'probe' | 'docs';
}

/**
 * OpenRouter asks integrators to identify themselves; these headers put
 * anyagent on their app leaderboard instead of showing up as anonymous.
 */
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/anyagent/anyagent',
  'X-Title': 'anyagent',
};

export const PROVIDER_OVERLAY: Record<string, ProviderOverlay> = {
  openrouter: {
    baseUrl: {
      'openai-chat': 'https://openrouter.ai/api/v1',
      'openai-responses': 'https://openrouter.ai/api/v1',
      anthropic: 'https://openrouter.ai/api',
    },
    responsesSource: 'probe',
    headers: OPENROUTER_HEADERS,
    console: 'https://openrouter.ai/keys',
    keyPrefix: 'sk-or-',
    anthropicSource: 'probe',
  },
  deepseek: {
    baseUrl: {
      'openai-chat': 'https://api.deepseek.com/v1',
      'openai-responses': 'https://api.deepseek.com/v1',
      anthropic: 'https://api.deepseek.com/anthropic',
    },
    responsesSource: 'docs',
    console: 'https://platform.deepseek.com/api_keys',
    anthropicSource: 'docs',
  },
  zai: {
    name: 'Z.ai',
    baseUrl: {
      'openai-chat': 'https://api.z.ai/api/paas/v4',
      'openai-responses': 'https://api.z.ai/api/paas/v4',
      anthropic: 'https://api.z.ai/api/anthropic',
    },
    console: 'https://z.ai/manage-apikey/apikey-list',
    anthropicSource: 'docs',
    responsesSource: 'docs',
  },
  'zai-coding-plan': {
    name: 'Z.ai Coding Plan',
    baseUrl: {
      'openai-chat': 'https://api.z.ai/api/coding/paas/v4',
      anthropic: 'https://api.z.ai/api/anthropic',
    },
    console: 'https://z.ai/manage-apikey/apikey-list',
    anthropicSource: 'docs',
  },
  zhipuai: {
    baseUrl: {
      'openai-chat': 'https://open.bigmodel.cn/api/paas/v4',
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
    },
    console: 'https://open.bigmodel.cn/usercenter/apikeys',
    anthropicSource: 'probe',
  },
  moonshotai: {
    baseUrl: {
      'openai-chat': 'https://api.moonshot.ai/v1',
      'openai-responses': 'https://api.moonshot.ai/v1',
      anthropic: 'https://api.moonshot.ai/anthropic',
    },
    responsesSource: 'probe',
    console: 'https://platform.moonshot.ai/console/api-keys',
    keyPrefix: 'sk-',
    anthropicSource: 'probe',
  },
  'moonshotai-cn': {
    baseUrl: {
      'openai-chat': 'https://api.moonshot.cn/v1',
      anthropic: 'https://api.moonshot.cn/anthropic',
    },
    anthropicSource: 'docs',
  },
  minimax: {
    baseUrl: {
      'openai-chat': 'https://api.minimax.io/v1',
      anthropic: 'https://api.minimax.io/anthropic',
    },
    console: 'https://platform.minimax.io/user-center/basic-information',
    anthropicSource: 'probe',
  },
  siliconflow: {
    baseUrl: {
      'openai-chat': 'https://api.siliconflow.com/v1',
      anthropic: 'https://api.siliconflow.com',
    },
    console: 'https://cloud.siliconflow.com/account/ak',
    anthropicSource: 'probe',
  },
  'novita-ai': {
    baseUrl: {
      'openai-chat': 'https://api.novita.ai/openai',
      anthropic: 'https://api.novita.ai/anthropic',
    },
    console: 'https://novita.ai/settings/key-management',
    anthropicSource: 'probe',
  },
  alibaba: {
    name: 'Alibaba (DashScope)',
    baseUrl: {
      'openai-chat': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      anthropic: 'https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy',
    },
    console: 'https://bailian.console.alibabacloud.com/',
    anthropicSource: 'docs',
  },
  xai: {
    name: 'xAI',
    baseUrl: {
      'openai-chat': 'https://api.x.ai/v1',
      'openai-responses': 'https://api.x.ai/v1',
      anthropic: 'https://api.x.ai',
    },
    responsesSource: 'probe',
    console: 'https://console.x.ai/',
    keyPrefix: 'xai-',
    anthropicSource: 'probe',
  },
  anthropic: {
    baseUrl: {
      anthropic: 'https://api.anthropic.com',
    },
    console: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
    anthropicSource: 'docs',
  },

  // Providers whose SDK hard-codes the endpoint, so models.dev has no `api`.
  openai: {
    baseUrl: {
      'openai-chat': 'https://api.openai.com/v1',
      'openai-responses': 'https://api.openai.com/v1',
    },
    console: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
  },
  groq: {
    baseUrl: {
      'openai-chat': 'https://api.groq.com/openai/v1',
      'openai-responses': 'https://api.groq.com/openai/v1',
    },
    responsesSource: 'probe',
    console: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
  },
  cerebras: {
    baseUrl: { 'openai-chat': 'https://api.cerebras.ai/v1' },
    console: 'https://cloud.cerebras.ai/platform',
    keyPrefix: 'csk-',
  },
  togetherai: {
    name: 'Together AI',
    baseUrl: {
      'openai-chat': 'https://api.together.xyz/v1',
      'openai-responses': 'https://api.together.xyz/v1',
    },
    responsesSource: 'probe',
    console: 'https://api.together.ai/settings/api-keys',
  },
  mistral: {
    baseUrl: { 'openai-chat': 'https://api.mistral.ai/v1' },
    console: 'https://console.mistral.ai/api-keys',
  },
  perplexity: {
    baseUrl: { 'openai-chat': 'https://api.perplexity.ai' },
    console: 'https://www.perplexity.ai/settings/api',
  },
  deepinfra: {
    baseUrl: { 'openai-chat': 'https://api.deepinfra.com/v1/openai' },
    console: 'https://deepinfra.com/dash/api_keys',
  },
  cohere: {
    baseUrl: { 'openai-chat': 'https://api.cohere.ai/compatibility/v1' },
    console: 'https://dashboard.cohere.com/api-keys',
  },
  google: {
    name: 'Google Gemini',
    baseUrl: { 'openai-chat': 'https://generativelanguage.googleapis.com/v1beta/openai' },
    console: 'https://aistudio.google.com/apikey',
  },
  vercel: {
    name: 'Vercel AI Gateway',
    baseUrl: {
      'openai-chat': 'https://ai-gateway.vercel.sh/v1',
      'openai-responses': 'https://ai-gateway.vercel.sh/v1',
    },
    responsesSource: 'probe',
    console: 'https://vercel.com/dashboard/ai-gateway',
  },
  'fireworks-ai': {
    baseUrl: {
      'openai-chat': 'https://api.fireworks.ai/inference/v1',
      'openai-responses': 'https://api.fireworks.ai/inference/v1',
    },
    responsesSource: 'probe',
    console: 'https://fireworks.ai/account/api-keys',
  },
  baseten: { console: 'https://app.baseten.co/settings/api-keys' },
  chutes: { console: 'https://chutes.ai/app/api' },
  nebius: { console: 'https://studio.nebius.com/settings/api-keys' },
  venice: {
    baseUrl: { 'openai-chat': 'https://api.venice.ai/api/v1' },
    console: 'https://venice.ai/settings/api',
  },
  lmstudio: {
    name: 'LM Studio',
    baseUrl: { 'openai-chat': 'http://127.0.0.1:1234/v1' },
    keyless: true,
    local: true,
  },

  // Cloud providers that authenticate with signed requests or ADC. A base URL
  // and a bearer token are not enough, so we say so instead of failing later.
  'amazon-bedrock': { unsupported: 'Bedrock uses SigV4 request signing, not bearer tokens.' },
  'google-vertex': { unsupported: 'Vertex AI uses Google application default credentials.' },
  'google-vertex-anthropic': {
    unsupported: 'Vertex AI uses Google application default credentials.',
  },
  azure: { unsupported: 'Azure OpenAI needs a per-deployment endpoint; use --base-url.' },
  'azure-cognitive-services': {
    unsupported: 'Azure OpenAI needs a per-deployment endpoint; use --base-url.',
  },
};

/**
 * Providers models.dev does not carry. Local runtimes matter most here: Ollama
 * serves an OpenAI-compatible API *and* an Anthropic-compatible one, which
 * makes it the zero-cost way to try every agent in this list.
 */
export const EXTRA_PROVIDERS: Record<string, Provider> = {
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    doc: 'https://ollama.com/library',
    env: ['OLLAMA_HOST'],
    keyless: true,
    local: true,
    baseUrl: {
      'openai-chat': 'http://127.0.0.1:11434/v1',
      anthropic: 'http://127.0.0.1:11434',
    },
  },
  llamacpp: {
    id: 'llamacpp',
    name: 'llama.cpp server (local)',
    doc: 'https://github.com/ggml-org/llama.cpp',
    env: [],
    keyless: true,
    local: true,
    baseUrl: { 'openai-chat': 'http://127.0.0.1:8080/v1' },
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM (local)',
    doc: 'https://docs.vllm.ai',
    env: ['VLLM_API_KEY'],
    keyless: true,
    local: true,
    baseUrl: { 'openai-chat': 'http://127.0.0.1:8000/v1' },
  },
};

/**
 * Map an AI SDK package name to the wire protocols its endpoint speaks. This is
 * how 150+ providers get correct routing without a hand-written entry each.
 */
export function wiresForSdk(npm: string | undefined): Wire[] {
  switch (npm) {
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return ['anthropic'];
    case '@ai-sdk/openai':
    case '@ai-sdk/azure':
      return ['openai-responses', 'openai-chat'];
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
    case '@ai-sdk/amazon-bedrock':
      return [];
    default:
      return ['openai-chat'];
  }
}
