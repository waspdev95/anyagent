import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import {
  findProjectConfig,
  getConfigValue,
  loadProjectConfig,
  loadUserConfig,
  resolveDefaults,
  saveUserConfig,
  setConfigValue,
} from '../src/config.js';
import { FileStore, envVarNameFor, keyLooksWrong, resolveKey } from '../src/credentials.js';
import { maskKey, redact } from '../src/errors.js';
import { parseJson, readJson, stripBom, writeFileAtomic, writeJson } from '../src/fsx.js';
import { resolvePaths } from '../src/paths.js';
import { tempDir } from './helpers.js';

describe('fsx', () => {
  test('strips a UTF-8 BOM before parsing', () => {
    // PowerShell writes a BOM by default; without this, JSON.parse throws on a
    // file that looks perfectly valid in an editor.
    assert.deepEqual(parseJson('﻿{"a":1}', 'test'), { a: 1 });
    assert.equal(stripBom('plain'), 'plain');
  });

  test('reports the file when JSON is malformed', () => {
    assert.throws(
      () => parseJson('{oops', '/tmp/config.json'),
      /\/tmp\/config\.json is not valid JSON/,
    );
  });

  test('missing and empty files fall back instead of throwing', async () => {
    const dir = tempDir();
    assert.deepEqual(await readJson(path.join(dir, 'nope.json'), { fallback: true }), {
      fallback: true,
    });
    await fsp.writeFile(path.join(dir, 'empty.json'), '   ');
    assert.deepEqual(await readJson(path.join(dir, 'empty.json'), { fallback: true }), {
      fallback: true,
    });
  });

  test('writes atomically and leaves no temp files behind', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'nested', 'config.json');
    await writeFileAtomic(file, 'hello');
    assert.equal(await fsp.readFile(file, 'utf8'), 'hello');
    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  test('restricts secret files on POSIX', { skip: process.platform === 'win32' }, async () => {
    const dir = tempDir();
    const file = path.join(dir, 'credentials.json');
    await writeJson(file, { keys: {} }, 0o600);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
});

describe('paths', () => {
  test('ANYAGENT_HOME wins over everything', () => {
    const paths = resolvePaths({ ANYAGENT_HOME: '/custom/state' }, '/home/tester');
    assert.equal(paths.state, path.resolve('/custom/state'));
  });

  test('XDG_CONFIG_HOME is honoured off Windows', { skip: process.platform === 'win32' }, () => {
    const paths = resolvePaths({ XDG_CONFIG_HOME: '/home/tester/.config' }, '/home/tester');
    assert.equal(paths.state, path.join('/home/tester/.config', 'anyagent'));
  });

  test('defaults to ~/.anyagent', () => {
    const paths = resolvePaths({}, path.join(path.sep, 'home', 'tester'));
    assert.equal(paths.state, path.join(path.sep, 'home', 'tester', '.anyagent'));
    assert.ok(paths.credentials.endsWith('credentials.json'));
  });
});

describe('project config discovery', () => {
  test('does not mistake the user state directory for a project config', async () => {
    // ~/.anyagent/config.json is anyagent's own global config. Treating it as a
    // project override would silently outrank per-agent defaults for every
    // project that lives under the home directory.
    const home = tempDir();
    const state = path.join(home, '.anyagent');
    await writeJson(path.join(state, 'config.json'), { model: 'global-model' });
    const project = path.join(home, 'code', 'app');
    fs.mkdirSync(project, { recursive: true });

    assert.equal(await findProjectConfig(project), undefined);
  });

  test('finds the nearest .anyagent.json walking up', async () => {
    const root = tempDir();
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    const marker = path.join(root, 'a', '.anyagent.json');
    await writeJson(marker, { model: 'project-model' });

    assert.equal(await findProjectConfig(nested), marker);
    const loaded = await loadProjectConfig(nested);
    assert.equal(loaded.config.model, 'project-model');
  });
});

describe('config layering', () => {
  test('later layers win, and per-agent beats global', () => {
    const resolved = resolveDefaults({
      agentId: 'claude',
      user: { provider: 'groq', model: 'llama', agents: { claude: { model: 'sonnet' } } },
      project: { model: 'project-model' },
      projectFile: '/repo/.anyagent.json',
      env: {},
      flags: {},
    });
    assert.equal(resolved.provider, 'groq');
    assert.equal(resolved.model, 'project-model');
    assert.equal(resolved.sources.model, 'project config (/repo/.anyagent.json)');
  });

  test('environment beats config and flags beat everything', () => {
    const resolved = resolveDefaults({
      agentId: 'claude',
      user: { provider: 'groq' },
      project: {},
      env: { ANYAGENT_PROVIDER: 'deepseek' },
      flags: { provider: 'openrouter' },
    });
    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.sources.provider, 'command line');
  });

  test('extra args accumulate across layers', () => {
    const resolved = resolveDefaults({
      agentId: 'claude',
      user: { args: ['--verbose'] },
      project: { agents: { claude: { args: ['--add-dir', 'src'] } } },
      env: {},
      flags: {},
    });
    assert.deepEqual(resolved.args, ['--verbose', '--add-dir', 'src']);
  });

  test('dotted keys read and write, with an agent shorthand', () => {
    let config = setConfigValue({}, 'model', 'gpt-5');
    config = setConfigValue(config, 'claude.provider', 'openrouter', ['claude']);
    assert.equal(getConfigValue(config, 'model'), 'gpt-5');
    assert.equal(getConfigValue(config, 'agents.claude.provider'), 'openrouter');
  });

  test('values are coerced, and unset removes the key', () => {
    let config = setConfigValue({}, 'autoRefreshCatalog', 'false');
    assert.equal(config.autoRefreshCatalog, false);
    config = setConfigValue(config, 'autoRefreshCatalog', undefined);
    assert.equal('autoRefreshCatalog' in config, false);
  });

  test('round-trips through disk with defaults applied', async () => {
    const file = path.join(tempDir(), 'config.json');
    await saveUserConfig(file, { provider: 'groq' });
    const loaded = await loadUserConfig(file);
    assert.equal(loaded.provider, 'groq');
    assert.equal(loaded.credentialStore, 'file');
  });
});

describe('credentials', () => {
  const provider = {
    id: 'openrouter',
    name: 'OpenRouter',
    env: ['OPENROUTER_API_KEY'],
    baseUrl: { 'openai-chat': 'https://openrouter.ai/api/v1' },
    keyPrefix: 'sk-or-',
  };

  test('file store round-trips and lists', async () => {
    const store = new FileStore(path.join(tempDir(), 'credentials.json'));
    assert.equal(await store.get('openrouter'), undefined);
    await store.set('openrouter', 'sk-or-v1-abc');
    assert.equal(await store.get('openrouter'), 'sk-or-v1-abc');
    assert.deepEqual(await store.list(), ['openrouter']);
    assert.equal(await store.delete('openrouter'), true);
    assert.equal(await store.delete('openrouter'), false);
  });

  test('resolution order: flag, scoped env, provider env, store', async () => {
    const store = new FileStore(path.join(tempDir(), 'credentials.json'));
    await store.set('openrouter', 'from-store');

    assert.equal((await resolveKey(provider, store, {}, 'from-flag'))?.key, 'from-flag');
    assert.equal(
      (await resolveKey(provider, store, { ANYAGENT_OPENROUTER_API_KEY: 'scoped' }))?.key,
      'scoped',
    );
    assert.equal(
      (await resolveKey(provider, store, { OPENROUTER_API_KEY: 'native' }))?.key,
      'native',
    );
    assert.equal((await resolveKey(provider, store, {}))?.key, 'from-store');
  });

  test('environment-sourced keys are marked ephemeral', async () => {
    const store = new FileStore(path.join(tempDir(), 'credentials.json'));
    const source = await resolveKey(provider, store, { OPENROUTER_API_KEY: 'native' });
    assert.equal(source?.ephemeral, true);
    assert.equal(source?.origin, 'OPENROUTER_API_KEY');
  });

  test('local providers need no key at all', async () => {
    const store = new FileStore(path.join(tempDir(), 'credentials.json'));
    const local = { ...provider, id: 'ollama', keyless: true, env: [] };
    assert.equal((await resolveKey(local, store, {}))?.origin, 'not required (local provider)');
  });

  test('scoped variable name is derived predictably', () => {
    assert.equal(envVarNameFor('openrouter'), 'ANYAGENT_OPENROUTER_API_KEY');
    assert.equal(envVarNameFor('fireworks-ai'), 'ANYAGENT_FIREWORKS_AI_API_KEY');
  });

  test('obvious paste mistakes are caught before an agent starts', () => {
    assert.match(keyLooksWrong(provider, '')!, /empty/);
    assert.match(keyLooksWrong(provider, 'sk-or-v1 abc')!, /whitespace/);
    assert.match(keyLooksWrong(provider, 'gsk_wrong')!, /sk-or-/);
    assert.equal(keyLooksWrong(provider, 'sk-or-v1-fine'), undefined);
  });
});

describe('secret hygiene', () => {
  test('masking shows enough to recognise, never enough to use', () => {
    assert.equal(maskKey('sk-or-v1-1234567890abcdef'), 'sk-or-v1...cdef');
    assert.equal(maskKey('short'), '*****');
  });

  test('redaction strips key-shaped strings from error text', () => {
    const text = 'failed with Authorization: Bearer sk-or-v1-abcdef0123456789 on retry';
    const cleaned = redact(text);
    assert.ok(!cleaned.includes('abcdef0123456789'));
    assert.match(cleaned, /redacted/);
    assert.ok(!redact('key gsk_abcdef0123456789').includes('abcdef0123456789'));
  });
});
