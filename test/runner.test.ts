import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { resolvePaths } from '../src/paths.js';
import {
  applyFiles,
  locate,
  pendingRestores,
  readExisting,
  readManifest,
  restoreAgent,
} from '../src/runner.js';
import { toToml, toYaml } from '../src/serialize.js';
import type { Agent, LaunchPlan } from '../src/types.js';
import { tempDir } from './helpers.js';

const stubAgent = (id: string, reads: string[] = []): Agent => ({
  id,
  name: id,
  description: 'test agent',
  homepage: 'https://example.com',
  wires: ['openai-chat'],
  bin: [id],
  install: { url: 'https://example.com' },
  reads: () => reads,
  plan: () => ({ command: { file: id, args: [] }, env: {}, files: [], notes: [] }),
});

function planWith(files: LaunchPlan['files']): LaunchPlan {
  return { command: { file: 'x', args: [] }, env: {}, files, notes: [] };
}

describe('applyFiles and restore', () => {
  test('backs up an existing file and restores it byte for byte', async () => {
    const home = tempDir();
    const paths = resolvePaths({ ANYAGENT_HOME: path.join(home, 'state') }, home);
    const target = path.join(home, 'settings.json');
    const original = '{"user":"original"}\n';
    await fsp.writeFile(target, original);

    const agent = stubAgent('droid');
    await applyFiles(agent, planWith([{ path: target, contents: '{"new":true}', backup: true }]), {
      paths,
    });

    assert.equal(await fsp.readFile(target, 'utf8'), '{"new":true}');
    assert.deepEqual(await pendingRestores(paths), ['droid']);

    const result = await restoreAgent('droid', paths);
    assert.deepEqual(result.restored, [target]);
    assert.equal(await fsp.readFile(target, 'utf8'), original);
    assert.deepEqual(await pendingRestores(paths), []);
  });

  test('a file anyagent created is removed rather than reverted', async () => {
    const home = tempDir();
    const paths = resolvePaths({ ANYAGENT_HOME: path.join(home, 'state') }, home);
    const target = path.join(home, 'new', 'config.json');

    await applyFiles(stubAgent('pi'), planWith([{ path: target, contents: '{}', backup: true }]), {
      paths,
    });
    assert.ok(fs.existsSync(target));

    const result = await restoreAgent('pi', paths);
    assert.deepEqual(result.removed, [target]);
    assert.equal(fs.existsSync(target), false);
  });

  test('several launches restore to the state before the first one', async () => {
    const home = tempDir();
    const paths = resolvePaths({ ANYAGENT_HOME: path.join(home, 'state') }, home);
    const target = path.join(home, 'settings.json');
    await fsp.writeFile(target, 'v0');

    const agent = stubAgent('droid');
    await applyFiles(agent, planWith([{ path: target, contents: 'v1', backup: true }]), { paths });
    await applyFiles(agent, planWith([{ path: target, contents: 'v2', backup: true }]), { paths });

    await restoreAgent('droid', paths);
    assert.equal(await fsp.readFile(target, 'utf8'), 'v0');
  });

  test('files without a backup flag are not tracked for restore', async () => {
    const home = tempDir();
    const paths = resolvePaths({ ANYAGENT_HOME: path.join(home, 'state') }, home);
    await applyFiles(
      stubAgent('dsh'),
      planWith([{ path: path.join(home, 'patch.yaml'), contents: 'a: 1' }]),
      { paths },
    );
    assert.deepEqual((await readManifest(paths.restoreManifest)).agents, {});
  });

  test('a missing backup is reported instead of failing silently', async () => {
    const home = tempDir();
    const paths = resolvePaths({ ANYAGENT_HOME: path.join(home, 'state') }, home);
    const target = path.join(home, 'settings.json');
    await fsp.writeFile(target, 'original');

    await applyFiles(
      stubAgent('droid'),
      planWith([{ path: target, contents: 'new', backup: true }]),
      {
        paths,
      },
    );

    const manifest = await readManifest(paths.restoreManifest);
    await fsp.rm(manifest.agents.droid![0]!.backup!, { force: true });

    const result = await restoreAgent('droid', paths);
    assert.deepEqual(result.missing, [target]);
  });
});

describe('readExisting', () => {
  test('loads declared files and ignores missing ones', async () => {
    const home = tempDir();
    const present = path.join(home, 'present.json');
    await fsp.writeFile(present, '{"a":1}');
    const agent = stubAgent('pi', [present, path.join(home, 'absent.json')]);

    const existing = await readExisting(agent, { home, stateDir: home, platform: 'linux' });
    assert.equal(existing.get(present), '{"a":1}');
    assert.equal(existing.size, 1);
  });
});

describe('locate', () => {
  test('finds a binary in an agent-specific directory', () => {
    const home = tempDir();
    const dir = path.join(home, '.opencode', 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const binary = path.join(dir, process.platform === 'win32' ? 'demo.cmd' : 'demo');
    fs.writeFileSync(binary, '');

    const agent: Agent = {
      ...stubAgent('demo'),
      extraPaths: () => [dir],
    };
    assert.equal(locate(agent, home), binary);
  });

  test('returns undefined when the agent is not installed', () => {
    assert.equal(locate(stubAgent('definitely-not-installed-xyz'), tempDir()), undefined);
  });
});

describe('serialisers', () => {
  test('TOML quotes strings and keeps table order', () => {
    const toml = toToml([
      { values: { model: 'a/b', model_context_window: 1000 } },
      { header: 'model_providers.anyagent', values: { name: 'X', wire_api: 'responses' } },
    ]);
    assert.equal(
      toml,
      'model = "a/b"\nmodel_context_window = 1000\n\n[model_providers.anyagent]\nname = "X"\nwire_api = "responses"\n',
    );
  });

  test('TOML quotes keys that are not bare', () => {
    assert.equal(toToml([{ values: { 'X-Title': 'x' } }]), 'X-Title = "x"\n');
    assert.equal(toToml([{ values: { 'a.b': 'x' } }]), '"a.b" = "x"\n');
  });

  test('YAML always quotes strings, so version-like values survive', () => {
    // Unquoted, `1.10` and `yes` would parse as a number and a boolean.
    const yaml = toYaml({ version: '1.10', enabled: 'yes', count: 3, flag: true });
    assert.equal(yaml, 'version: "1.10"\nenabled: "yes"\ncount: 3\nflag: true\n');
  });

  test('YAML nests maps and lists', () => {
    const yaml = toYaml({ providers: { anyagent: { models: [{ id: 'a' }, { id: 'b' }] } } });
    assert.equal(
      yaml,
      'providers:\n  anyagent:\n    models:\n      -\n        id: "a"\n      -\n        id: "b"\n',
    );
  });

  test('YAML renders empty containers inline', () => {
    assert.equal(toYaml({ a: {}, b: [] }), 'a: {}\nb: []\n');
  });
});
