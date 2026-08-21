import path from 'node:path';

import type { Agent, LaunchPlan, PlanContext } from '../types.js';
import { headerLines } from './common.js';

/**
 * Claude Code.
 *
 * Fully environment-driven: nothing on disk is touched, so `anyagent claude`
 * and a plain `claude` can be used side by side in different terminals against
 * different models.
 *
 * Claude Code speaks the Anthropic Messages API and nothing else, which is why
 * it can only be pointed at providers that expose an Anthropic-compatible
 * endpoint. `anyagent providers --wire anthropic` lists them.
 */
export const claude: Agent = {
  id: 'claude',
  name: 'Claude Code',
  description: "Anthropic's coding agent, with subagents and hooks",
  aliases: ['claude-code', 'cc'],
  homepage: 'https://code.claude.com/docs',
  wires: ['anthropic'],
  bin: ['claude'],
  supportsSmallModel: true,
  install: {
    command: ['npm', 'install', '-g', '@anthropic-ai/claude-code'],
    url: 'https://code.claude.com/docs/en/quickstart',
  },
  extraPaths: (home) => [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')],

  plan(ctx: PlanContext): LaunchPlan {
    const { target } = ctx;
    const model = target.model.id;
    const small = target.smallModel?.id ?? model;
    const isAnthropic = target.provider.id === 'anthropic';

    // Which variable carries the key decides which header Claude Code sends,
    // and the two are not interchangeable:
    //
    //   ANTHROPIC_API_KEY    -> x-api-key, and treated as a direct-Anthropic
    //                           credential that can take precedence over a saved
    //                           login
    //   ANTHROPIC_AUTH_TOKEN -> Authorization: Bearer, which is what every
    //                           gateway expects
    //
    // Setting both - which this used to do - makes Claude Code warn about
    // conflicting auth and can send it down the direct-Anthropic path. So a
    // gateway gets the bearer token and an explicitly empty api key, exactly as
    // OpenRouter's own guide instructs, while api.anthropic.com gets the
    // x-api-key it actually reads.
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: target.baseUrl,
      ...(isAnthropic
        ? { ANTHROPIC_API_KEY: target.apiKey }
        : { ANTHROPIC_AUTH_TOKEN: target.apiKey, ANTHROPIC_API_KEY: '' }),

      // Every tier points at the chosen model: a third-party endpoint has no
      // "opus" or "haiku" to fall back to, and an unmapped tier is a 404 at the
      // worst possible moment.
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: small,
      ANTHROPIC_SMALL_FAST_MODEL: small,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
    };

    // Without a real context window Claude Code assumes 200K and compacts far
    // too late - or never - on models with a smaller window. Both variable
    // names are set because the knob was renamed between releases.
    if (target.model.contextLimit) {
      env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(target.model.contextLimit);
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(target.model.contextLimit);
    }
    if (target.model.outputLimit) {
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(target.model.outputLimit);
    }

    const headers = headerLines(target);
    if (headers) env.ANTHROPIC_CUSTOM_HEADERS = headers;

    const notes: string[] = [];
    if (!isAnthropic) {
      // Error reports and commit attribution are addressed to Anthropic. When
      // the model is someone else's, sending either is wrong on both counts.
      env.DISABLE_ERROR_REPORTING = '1';
      env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
      notes.push(
        'Error reporting and Anthropic commit attribution are off for third-party models.',
      );
    }

    return {
      command: { file: 'claude', args: ['--model', model, ...ctx.passthrough] },
      env,
      files: [],
      notes,
    };
  },
};
