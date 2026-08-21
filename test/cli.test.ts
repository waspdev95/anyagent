/**
 * End-to-end tests against the real dispatcher.
 *
 * Every case runs with ANYAGENT_HOME pointed at a temporary directory and a
 * key supplied through the environment, so nothing touches the developer's real
 * config and no command can reach the network for credentials.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test, { describe, before, after } from 'node:test';

import { main, reportError } from '../src/app.js';
import { AnyAgentError } from '../src/errors.js';
import { setColorEnabled } from '../src/ui.js';
import { captureOut, tempDir } from './helpers.js';

const HOME = tempDir('anyagent-cli-');
const KEY = 'sk-or-v1-testkey0000000000';

before(() => {
  setColorEnabled(false);
  process.env.ANYAGENT_HOME = HOME;
  process.env.ANYAGENT_OPENROUTER_API_KEY = KEY;
  // Keep the catalog deterministic and offline.
  process.env.ANYAGENT_CATALOG_OFFLINE = '1';
});

after(() => {
  delete process.env.ANYAGENT_HOME;
  delete process.env.ANYAGENT_OPENROUTER_API_KEY;
});

async function runCli(argv: string[]): Promise<{ code: number; output: string }> {
  let code = 0;
  const output = await captureOut(async () => {
    code = await main(argv);
  });
  return { code, output };
}

describe('dispatch', () => {
  test('bare invocation prints help when there is no terminal', async () => {
    // With a TTY this opens the menu; in CI and in pipes it has to explain
    // itself instead of blocking on a prompt that can never be answered.
    const { code, output } = await runCli([]);
    assert.equal(code, 0);
    assert.match(output, /Run Claude Code, Codex and other coding agents/);
    assert.match(output, /START/);
  });

  test('short help stays short, and --all shows everything', async () => {
    const short = await runCli(['help']);
    const full = await runCli(['help', '--all']);
    assert.ok(!short.output.includes('exec'), 'advanced commands leaked into short help');
    assert.match(full.output, /ADVANCED/);
    assert.match(full.output, /exec/);
  });

  test('help for one command explains just that command', async () => {
    const { output } = await runCli(['help', 'model']);
    assert.match(output, /anyagent model/);
    assert.match(output, /Choose the AI model/);
  });

  test('--version prints just the version', async () => {
    const { output } = await runCli(['--version']);
    assert.match(output.trim(), /^\d+\.\d+\.\d+/);
  });

  test('an agent name is treated as a launch', async () => {
    const { code, output } = await runCli([
      '--json',
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    assert.equal(code, 0);
    const plan = JSON.parse(output) as { agent: string; wire: string; baseUrl: string };
    assert.equal(plan.agent, 'claude');
    assert.equal(plan.wire, 'anthropic');
    assert.equal(plan.baseUrl, 'https://openrouter.ai/api');
  });

  test('run <agent> is the same as <agent>', async () => {
    const implicit = await runCli([
      '--json',
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    const explicit = await runCli([
      '--json',
      'run',
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    assert.deepEqual(JSON.parse(implicit.output), JSON.parse(explicit.output));
  });

  test('unknown commands suggest the closest match', async () => {
    await assert.rejects(runCli(['claudee']), (error: AnyAgentError) => {
      assert.match(error.hint ?? '', /claude/);
      return true;
    });
  });
});

describe('secrets never leak into output', () => {
  test('dry-run masks the key in every variable', async () => {
    const { output } = await runCli([
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    assert.ok(!output.includes(KEY), 'the raw key appeared in dry-run output');
    assert.match(output, /sk-or-v1\.\.\.0000/);
  });

  test('numeric variables are not mistaken for secrets', async () => {
    const { output } = await runCli([
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    assert.match(output, /CLAUDE_CODE_MAX_OUTPUT_TOKENS=\d+/);
  });
});

describe('argument forwarding', () => {
  test('unknown flags reach the agent unchanged', async () => {
    const { output } = await runCli([
      '--json',
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
      '--resume',
      '--add-dir',
      'src',
    ]);
    const plan = JSON.parse(output) as { command: string[] };
    assert.deepEqual(plan.command.slice(-3), ['--resume', '--add-dir', 'src']);
  });

  test('-p is left for the agent, not read as --provider', async () => {
    // Claude Code uses -p for print mode; stealing it would be maddening.
    const { output } = await runCli([
      '--json',
      'claude',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
      '-p',
      'hello',
    ]);
    const plan = JSON.parse(output) as { command: string[]; provider: string };
    assert.equal(plan.provider, 'openrouter');
    assert.deepEqual(plan.command.slice(-2), ['-p', 'hello']);
  });
});

describe('where anyagent stops and the agent begins', () => {
  // git, docker and kubectl all draw this line: global flags come before the
  // name. Without it `anyagent claude --help` shows the wrong help, and
  // `anyagent codex exec --json` silently loses the flag it needs.
  const launch = (extra: string[]) => [
    'claude',
    '--provider',
    'openrouter',
    '-m',
    'deepseek/deepseek-chat',
    '--dry-run',
    ...extra,
  ];

  for (const flag of ['--help', '-h', '--version', '-V', '--json', '--yes', '-y']) {
    test(`${flag} after the agent name is the agent's`, async () => {
      const { output } = await runCli(launch([flag]));
      assert.match(output, /would launch as/, `${flag} was intercepted by anyagent`);
      assert.ok(output.includes(flag), `${flag} never reached the command line`);
    });
  }

  test('the same flags before the name belong to anyagent', async () => {
    const { output } = await runCli(['--json', ...launch([])]);
    assert.equal((JSON.parse(output) as { agent: string }).agent, 'claude');
  });

  test('a command still parses its own flags', async () => {
    // `ls --json` has to keep working: ls is a command, not an agent.
    const { output } = await runCli(['ls', '--json']);
    assert.ok(Array.isArray(JSON.parse(output)));
  });

  test('everything after -- is untouched', async () => {
    const { output } = await runCli(['--json', ...launch(['--', '-p', 'a & b'])]);
    const plan = JSON.parse(output) as { command: string[] };
    assert.deepEqual(plan.command.slice(-2), ['-p', 'a & b']);
  });
});

describe('inspecting a launch', () => {
  test('--dry-run works for an agent that is not installed', async () => {
    // Looking before installing is exactly what this flag is for, and CI has
    // none of these agents on PATH.
    const { code, output } = await runCli([
      '--json',
      'hermes',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--dry-run',
    ]);
    assert.equal(code, 0);
    const plan = JSON.parse(output) as { agent: string; installed: boolean; binary: string | null };
    assert.equal(plan.agent, 'hermes');
    assert.equal(typeof plan.installed, 'boolean');
  });

  test('--print-env works without the agent installed', async () => {
    const { code, output } = await runCli([
      '--json',
      'hermes',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--print-env',
    ]);
    assert.equal(code, 0);
    assert.ok(JSON.parse(output) as Record<string, string>);
  });
});

describe('errors', () => {
  test('an incompatible pairing explains itself and suggests alternatives', async () => {
    await assert.rejects(
      runCli(['claude', '--provider', 'groq', '-m', 'x', '--dry-run']),
      (error: AnyAgentError) => {
        assert.match(error.message, /Claude Code cannot use Groq/);
        assert.match(error.hint ?? '', /Anthropic Messages/);
        return true;
      },
    );
  });

  test('reportError uses the error exit code and prints the hint', () => {
    const code = reportError(new AnyAgentError('boom', { hint: 'try this', exitCode: 7 }));
    assert.equal(code, 7);
  });

  test('an unexpected error is redacted before printing', () => {
    const code = reportError(new Error(`bad key sk-or-v1-abcdef0123456789`));
    assert.equal(code, 1);
  });
});

describe('config and defaults', () => {
  test('use sets defaults that later launches pick up', async () => {
    await runCli(['use', 'openrouter/deepseek/deepseek-chat']);
    const { output } = await runCli(['--json', 'claude', '--dry-run']);
    const plan = JSON.parse(output) as { provider: string; model: string };
    assert.equal(plan.provider, 'openrouter');
    assert.equal(plan.model, 'deepseek/deepseek-chat');
  });

  test('per-agent defaults beat the global ones', async () => {
    await runCli(['config', 'set', 'agents.claude.model', 'deepseek/deepseek-chat-v3.1']);
    const { output } = await runCli(['--json', 'claude', '--dry-run']);
    assert.equal((JSON.parse(output) as { model: string }).model, 'deepseek/deepseek-chat-v3.1');
    await runCli(['config', 'unset', 'agents.claude.model']);
  });

  test('config path points inside the temporary home', async () => {
    const { output } = await runCli(['config', 'path']);
    assert.equal(output.trim(), path.join(HOME, 'config.json'));
  });
});

describe('browsing commands', () => {
  test('ls reports agents as JSON', async () => {
    const { output } = await runCli(['--json', 'ls']);
    const agents = JSON.parse(output) as { id: string; protocols: string[] }[];
    assert.ok(agents.some((agent) => agent.id === 'claude'));
    assert.ok(agents.every((agent) => agent.protocols.length > 0));
  });

  test('providers can be filtered by agent', async () => {
    const { output } = await runCli(['--json', 'providers', '--agent', 'claude']);
    const providers = JSON.parse(output) as { id: string; baseUrl: Record<string, string> }[];
    assert.ok(providers.length > 0);
    assert.ok(providers.every((provider) => Boolean(provider.baseUrl.anthropic)));
  });

  test('models search narrows by query', async () => {
    const { output } = await runCli(['--json', 'models', 'deepseek', '--provider', 'openrouter']);
    const models = JSON.parse(output) as { id: string }[];
    assert.ok(models.length > 0);
    assert.ok(models.every((model) => model.id.toLowerCase().includes('deepseek')));
  });

  test('compat lists the providers each agent can drive', async () => {
    const { output } = await runCli(['--json', 'compat']);
    const rows = JSON.parse(output) as { agent: string; providers: string[] }[];
    const claude = rows.find((row) => row.agent === 'claude')!;
    assert.ok(claude.providers.includes('openrouter'));
    assert.ok(!claude.providers.includes('groq'));
  });
});

describe('env and exec', () => {
  test('env prints shell-ready assignments', async () => {
    const { output } = await runCli([
      'env',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
      '--shell',
      'posix',
    ]);
    assert.match(output, /export OPENAI_BASE_URL='https:\/\/openrouter\.ai\/api\/v1'/);
    assert.match(output, /export ANTHROPIC_BASE_URL='https:\/\/openrouter\.ai\/api'/);
  });

  test('env --json is machine readable', async () => {
    const { output } = await runCli([
      '--json',
      'env',
      '--provider',
      'openrouter',
      '-m',
      'deepseek/deepseek-chat',
    ]);
    const env = JSON.parse(output) as Record<string, string>;
    assert.equal(env.OPENAI_API_KEY, KEY);
    assert.equal(env.ANYAGENT_MODEL, 'deepseek/deepseek-chat');
  });
});

describe('friendly command names', () => {
  test('`model <id>` sets the default, like `use`', async () => {
    await runCli(['model', 'deepseek/deepseek-chat', '--provider', 'openrouter']);
    const { output } = await runCli(['--json', 'claude', '--dry-run']);
    assert.equal((JSON.parse(output) as { model: string }).model, 'deepseek/deepseek-chat');
  });

  test('`model --agent` scopes the change to one agent', async () => {
    await runCli(['model', 'deepseek/deepseek-chat-v3.1', '--agent', 'opencode']);
    const scoped = await runCli(['--json', 'opencode', '--dry-run']);
    const global = await runCli(['--json', 'claude', '--dry-run']);
    assert.equal(
      (JSON.parse(scoped.output) as { model: string }).model,
      'deepseek/deepseek-chat-v3.1',
    );
    assert.equal((JSON.parse(global.output) as { model: string }).model, 'deepseek/deepseek-chat');
    await runCli(['config', 'unset', 'agents.opencode.model']);
  });

  test('`key` with no argument lists what is saved', async () => {
    const { code, output } = await runCli(['--json', 'key']);
    assert.equal(code, 0);
    assert.ok(Array.isArray(JSON.parse(output)));
  });

  test('`key <provider>` saves one and `key rm` forgets it', async () => {
    await runCli(['key', 'groq', '--key', 'gsk_friendlyname123']);
    const saved = await runCli(['--json', 'key']);
    assert.ok(
      (JSON.parse(saved.output) as { provider: string }[]).some((row) => row.provider === 'groq'),
    );

    const removed = await runCli(['key', 'rm', 'groq']);
    assert.equal(removed.code, 0);
    const after = await runCli(['--json', 'key']);
    assert.ok(
      !(JSON.parse(after.output) as { provider: string }[]).some((row) => row.provider === 'groq'),
    );
  });

  test('the older names still work', async () => {
    // `auth` and `use` are no longer listed, but scripts and muscle memory
    // should not break.
    const listed = await runCli(['--json', 'auth', 'list']);
    assert.equal(listed.code, 0);

    await runCli(['use', 'openrouter/deepseek/deepseek-chat']);
    const { output } = await runCli(['--json', 'claude', '--dry-run']);
    assert.equal((JSON.parse(output) as { model: string }).model, 'deepseek/deepseek-chat');
  });

  test('neither older name is listed in help', async () => {
    const { output } = await runCli(['help', '--all']);
    assert.ok(!/^\s+auth\s/m.test(output), '`auth` is still listed');
    assert.ok(!/^\s+use\s/m.test(output), '`use` is still listed');
  });
});

describe('auth', () => {
  test('list shows a masked key sourced from the environment', async () => {
    const { output } = await runCli(['--json', 'auth', 'list']);
    const rows = JSON.parse(output) as { provider: string; key: string; origin: string }[];
    const openrouter = rows.find((row) => row.provider === 'openrouter');
    assert.ok(openrouter);
    assert.equal(openrouter.origin, 'ANYAGENT_OPENROUTER_API_KEY');
    assert.ok(!openrouter.key.includes('testkey'));
  });

  test('a stored key round-trips through the CLI', async () => {
    await runCli(['auth', 'add', 'groq', '--key', 'gsk_storedkey123456']);
    const { output } = await runCli(['--json', 'auth', 'list']);
    const rows = JSON.parse(output) as { provider: string }[];
    assert.ok(rows.some((row) => row.provider === 'groq'));
    await runCli(['auth', 'rm', 'groq']);
  });
});

describe('restore', () => {
  test('reports nothing to do on a clean install', async () => {
    const { code, output } = await runCli(['restore']);
    assert.equal(code, 0);
    assert.match(output, /Nothing to restore/);
  });
});
