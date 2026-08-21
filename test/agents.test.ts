import assert from 'node:assert/strict';
import path from 'node:path';
import test, { describe } from 'node:test';

import { AGENTS, findAgent } from '../src/agents/index.js';
import { claude } from '../src/agents/claude.js';
import { codex, compareVersions, supportsModelCatalog } from '../src/agents/codex.js';
import { cline } from '../src/agents/cline.js';
import { droid } from '../src/agents/droid.js';
import { dsh } from '../src/agents/dsh.js';
import { hermes } from '../src/agents/hermes.js';
import { openclaw } from '../src/agents/openclaw.js';
import { opencode, inlineConfig } from '../src/agents/opencode.js';
import { pi } from '../src/agents/pi.js';
import { copilot, qwen } from '../src/agents/env-only.js';
import { fixtureContext, fixtureTarget } from './helpers.js';

describe('registry', () => {
  test('ids and aliases are unique', () => {
    const seen = new Set<string>();
    for (const agent of AGENTS) {
      for (const name of [agent.id, ...(agent.aliases ?? [])]) {
        assert.ok(!seen.has(name), `duplicate agent name: ${name}`);
        seen.add(name);
      }
    }
  });

  test('every agent declares at least one protocol and install route', () => {
    for (const agent of AGENTS) {
      assert.ok(agent.wires.length > 0, `${agent.id} has no protocol`);
      assert.ok(agent.bin.length > 0, `${agent.id} has no binary name`);
      assert.ok(agent.install.url.startsWith('https://'), `${agent.id} has no install docs`);
    }
  });

  test('lookup is case-insensitive and alias-aware', () => {
    assert.equal(findAgent('CLAUDE')?.id, 'claude');
    assert.equal(findAgent('claude-code')?.id, 'claude');
    assert.equal(findAgent('deepseek-harness')?.id, 'dsh');
    assert.equal(findAgent('nope'), undefined);
  });

  test('planning never mutates the context it was given', () => {
    for (const agent of AGENTS) {
      const context = fixtureContext({
        target: fixtureTarget(
          agent.wires.includes('anthropic') && !agent.wires.includes('openai-chat')
            ? { wire: 'anthropic', baseUrl: 'https://openrouter.ai/api' }
            : {},
        ),
      });
      const snapshot = JSON.stringify(context.target);
      agent.plan(context);
      assert.equal(JSON.stringify(context.target), snapshot, `${agent.id} mutated its target`);
    }
  });
});

describe('claude', () => {
  const plan = claude.plan(
    fixtureContext({
      target: fixtureTarget({ wire: 'anthropic', baseUrl: 'https://openrouter.ai/api' }),
      passthrough: ['--resume'],
    }),
  );

  test('points every model tier at the chosen model', () => {
    for (const name of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'CLAUDE_CODE_SUBAGENT_MODEL',
    ]) {
      assert.equal(plan.env[name], 'deepseek/deepseek-chat', `${name} was not redirected`);
    }
  });

  test('sends the key in both header styles', () => {
    assert.equal(plan.env.ANTHROPIC_API_KEY, 'sk-or-v1-testkey0000000000');
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, 'sk-or-v1-testkey0000000000');
  });

  test('declares the real context window so compaction is not mistimed', () => {
    assert.equal(plan.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '163840');
    assert.equal(plan.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '163840');
    assert.equal(plan.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '16000');
  });

  test('disables Anthropic error reporting for third-party models', () => {
    assert.equal(plan.env.DISABLE_ERROR_REPORTING, '1');
    assert.equal(plan.env.CLAUDE_CODE_ATTRIBUTION_HEADER, '0');
  });

  test('keeps reporting on when the provider really is Anthropic', () => {
    const target = fixtureTarget({ wire: 'anthropic', baseUrl: 'https://api.anthropic.com' });
    target.provider = { ...target.provider, id: 'anthropic', name: 'Anthropic' };
    const direct = claude.plan(fixtureContext({ target }));
    assert.equal(direct.env.DISABLE_ERROR_REPORTING, undefined);
  });

  test('forwards user arguments after its own', () => {
    assert.deepEqual(plan.command.args, ['--model', 'deepseek/deepseek-chat', '--resume']);
  });

  test('writes nothing to disk', () => {
    assert.deepEqual(plan.files, []);
  });
});

describe('codex', () => {
  const context = fixtureContext({
    target: fixtureTarget({ wire: 'openai-responses' }),
    agentVersion: '0.146.0',
  });
  const plan = codex.plan(context);
  const overrides = plan.command.args.filter((_, index) => plan.command.args[index - 1] === '-c');

  test('requires the Responses API', () => {
    // codex removed wire_api = "chat"; declaring it would fail at config load.
    assert.ok(overrides.includes('model_providers.anyagent.wire_api="responses"'));
    assert.deepEqual(codex.wires, ['openai-responses']);
  });

  test('never touches the user config file', () => {
    assert.ok(overrides.includes('model_provider="anyagent"'));
    assert.ok(plan.files.every((file) => !file.path.includes('.codex')));
  });

  test('passes the key by variable name, not by value', () => {
    assert.ok(overrides.includes('model_providers.anyagent.env_key="ANYAGENT_CODEX_API_KEY"'));
    assert.equal(plan.env.ANYAGENT_CODEX_API_KEY, 'sk-or-v1-testkey0000000000');
    assert.ok(!overrides.some((override) => override.includes('sk-or-v1')));
  });

  test('omits model_max_output_tokens, which codex rejects', () => {
    assert.ok(!overrides.some((override) => override.startsWith('model_max_output_tokens')));
    assert.ok(overrides.includes('model_context_window=163840'));
  });

  test('writes a model catalog with the field codex requires', () => {
    const catalogFile = plan.files.find((file) => file.path.endsWith('model-catalog.json'));
    assert.ok(catalogFile, 'no catalog file planned');
    const parsed = JSON.parse(catalogFile.contents) as {
      models: { slug: string; context_window: number; experimental_supported_tools: unknown[] }[];
    };
    assert.equal(parsed.models[0]?.slug, 'deepseek/deepseek-chat');
    assert.equal(parsed.models[0]?.context_window, 163_840);
    assert.deepEqual(parsed.models[0]?.experimental_supported_tools, []);
  });

  test('skips the catalog on releases that predate it', () => {
    const old = codex.plan(fixtureContext({ agentVersion: '0.120.0' }));
    assert.deepEqual(old.files, []);
    assert.ok(supportsModelCatalog('0.134.0'));
    assert.ok(!supportsModelCatalog('0.133.9'));
    assert.ok(supportsModelCatalog(undefined));
  });

  test('compares versions numerically, not lexically', () => {
    assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('v2.1.0', '2.0.9'), 1);
  });
});

describe('opencode', () => {
  test('passes its whole config in an environment variable', () => {
    const plan = opencode.plan(fixtureContext());
    assert.deepEqual(plan.files, []);
    const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT!) as {
      model: string;
      provider: Record<string, { options: { baseURL: string; apiKey: string } }>;
    };
    assert.equal(config.model, 'anyagent/deepseek/deepseek-chat');
    assert.equal(config.provider.anyagent?.options.baseURL, 'https://openrouter.ai/api/v1');
    assert.equal(config.provider.anyagent?.options.apiKey, 'sk-or-v1-testkey0000000000');
  });

  test('carries provider headers through', () => {
    const target = fixtureTarget();
    target.provider = { ...target.provider, headers: { 'X-Title': 'anyagent' } };
    const config = JSON.parse(inlineConfig(target)) as {
      provider: Record<string, { options: { headers?: Record<string, string> } }>;
    };
    assert.deepEqual(config.provider.anyagent?.options.headers, { 'X-Title': 'anyagent' });
  });
});

describe('config-merging agents', () => {
  test('droid keeps the user models and replaces only its own', () => {
    const file = droid.reads!(fixtureContext())[0]!;
    const context = fixtureContext({
      existing: new Map([
        [
          file,
          JSON.stringify({
            customModels: [
              { id: 'anyagent:old', model: 'old' },
              { id: 'mine', model: 'my-model', apiKey: 'secret' },
            ],
            otherSetting: 'keep me',
          }),
        ],
      ]),
    });

    const plan = droid.plan(context);
    const written = JSON.parse(plan.files[0]!.contents) as {
      customModels: { id: string }[];
      otherSetting: string;
      sessionDefaultSettings: { model: string };
    };

    assert.equal(written.otherSetting, 'keep me');
    assert.deepEqual(
      written.customModels.map((model) => model.id),
      ['anyagent:deepseek/deepseek-chat', 'mine'],
    );
    assert.equal(written.sessionDefaultSettings.model, 'anyagent:deepseek/deepseek-chat');
    assert.equal(plan.files[0]!.backup, true);
  });

  test('droid handles a config file with a UTF-8 BOM', () => {
    const file = droid.reads!(fixtureContext())[0]!;
    const context = fixtureContext({
      existing: new Map([[file, `\uFEFF${JSON.stringify({ otherSetting: 'kept' })}`]]),
    });
    const written = JSON.parse(droid.plan(context).files[0]!.contents) as { otherSetting: string };
    assert.equal(written.otherSetting, 'kept');
  });

  test('pi writes both models.json and settings.json', () => {
    const plan = pi.plan(fixtureContext());
    assert.deepEqual(
      plan.files.map((file) => file.path.split(/[\\/]/).pop()),
      ['models.json', 'settings.json'],
    );
    const models = JSON.parse(plan.files[0]!.contents) as {
      providers: Record<string, { baseUrl: string; api: string }>;
    };
    assert.equal(models.providers.anyagent?.api, 'openai-completions');
    const settings = JSON.parse(plan.files[1]!.contents) as { defaultModel: string };
    assert.equal(settings.defaultModel, 'deepseek/deepseek-chat');
  });

  test('pi preserves models the user added by hand', () => {
    const file = pi.reads!(fixtureContext())[0]!;
    const context = fixtureContext({
      existing: new Map([
        [
          file,
          JSON.stringify({
            providers: { anyagent: { models: [{ id: 'hand-written' }] }, other: { keep: true } },
          }),
        ],
      ]),
    });
    const models = JSON.parse(pi.plan(context).files[0]!.contents) as {
      providers: Record<string, { models?: { id: string }[]; keep?: boolean }>;
    };
    assert.deepEqual(
      models.providers.anyagent?.models?.map((model) => model.id),
      ['deepseek/deepseek-chat', 'hand-written'],
    );
    assert.equal(models.providers.other?.keep, true);
  });

  test('openclaw sets the primary model and picks the right api', () => {
    const chat = openclaw.plan(fixtureContext());
    const config = JSON.parse(chat.files[0]!.contents) as {
      models: { providers: Record<string, { api: string }> };
      agents: { defaults: { model: { primary: string } } };
    };
    assert.equal(config.models.providers.anyagent?.api, 'openai-completions');
    assert.equal(config.agents.defaults.model.primary, 'anyagent/deepseek/deepseek-chat');

    const anthropic = openclaw.plan(
      fixtureContext({ target: fixtureTarget({ wire: 'anthropic' }) }),
    );
    const anthropicConfig = JSON.parse(anthropic.files[0]!.contents) as {
      models: { providers: Record<string, { api: string }> };
    };
    assert.equal(anthropicConfig.models.providers.anyagent?.api, 'anthropic-messages');
  });

  test('cline selects its provider and records a deterministic timestamp', () => {
    const plan = cline.plan(fixtureContext());
    const config = JSON.parse(plan.files[0]!.contents) as {
      lastUsedProvider: string;
      providers: Record<string, { updatedAt: string; settings: { baseUrl: string } }>;
    };
    assert.equal(config.lastUsedProvider, 'anyagent');
    assert.equal(config.providers.anyagent?.updatedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(config.providers.anyagent?.settings.baseUrl, 'https://openrouter.ai/api/v1');
  });
});

describe('isolated and patch-based agents', () => {
  test('hermes runs from its own profile directory', () => {
    const plan = hermes.plan(fixtureContext());
    assert.ok(plan.env.HERMES_HOME?.includes('.anyagent'));
    assert.ok(plan.files[0]!.path.startsWith(plan.env.HERMES_HOME!));
    assert.match(plan.files[0]!.contents, /provider: "anyagent"/);
    // The user's own hermes home is never written to - only mentioned in a note.
    const touched = [plan.env.HERMES_HOME ?? '', ...plan.files.map((file) => file.path)];
    assert.ok(touched.every((entry) => !entry.includes(`${path.sep}.hermes`)));
  });

  test('dsh layers a patch instead of editing settings', () => {
    const plan = dsh.plan(fixtureContext());
    assert.deepEqual(plan.command.args.slice(0, 2), ['web', '--patch']);
    assert.match(plan.files[0]!.contents, /apiKeyEnv: "ANYAGENT_DSH_API_KEY"/);
    // The key itself is passed through the environment, never written down.
    assert.ok(!plan.files[0]!.contents.includes('sk-or-v1'));
    assert.equal(plan.env.ANYAGENT_DSH_API_KEY, 'sk-or-v1-testkey0000000000');
  });

  test('dsh lets an explicit subcommand win', () => {
    const plan = dsh.plan(fixtureContext({ passthrough: ['tui', '--verbose'] }));
    assert.deepEqual(plan.command.args.slice(0, 2), ['tui', '--patch']);
    assert.equal(plan.command.args.at(-1), '--verbose');
  });
});

describe('environment-only agents', () => {
  test('copilot uses its bring-your-own-provider variables', () => {
    const plan = copilot.plan(
      fixtureContext({ target: fixtureTarget({ wire: 'openai-responses' }) }),
    );
    assert.equal(plan.env.COPILOT_PROVIDER_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(plan.env.COPILOT_PROVIDER_WIRE_API, 'responses');
    assert.equal(plan.env.COPILOT_MODEL, 'deepseek/deepseek-chat');
  });

  test('qwen only sets OPENAI_* for the child process', () => {
    const plan = qwen.plan(fixtureContext());
    assert.equal(plan.env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(plan.env.OPENAI_MODEL, 'deepseek/deepseek-chat');
    assert.deepEqual(plan.files, []);
  });
});
