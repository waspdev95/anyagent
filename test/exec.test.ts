import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { buildCommand, commonBinPaths, quoteForCmd, which } from '../src/exec.js';

describe('which', () => {
  const files = new Set([
    'C:\\tools\\codex.EXE',
    'C:\\npm\\opencode.cmd',
    '/usr/local/bin/claude',
    '/home/tester/.local/bin/droid',
  ]);
  const isFile = (file: string): boolean => files.has(file);

  test('finds a POSIX binary on PATH', () => {
    const found = which('claude', {
      platform: 'linux',
      env: { PATH: '/usr/bin:/usr/local/bin' },
      isFile,
    });
    assert.equal(found, '/usr/local/bin/claude');
  });

  test('searches extra directories after PATH', () => {
    const found = which('droid', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      extraPaths: ['/home/tester/.local/bin'],
      isFile,
    });
    assert.equal(found, '/home/tester/.local/bin/droid');
  });

  test('honours PATHEXT on Windows', () => {
    const found = which('codex', {
      platform: 'win32',
      env: { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.CMD' },
      isFile,
    });
    assert.equal(found, 'C:\\tools\\codex.EXE');
  });

  test('finds npm .cmd shims on Windows', () => {
    const found = which('opencode', {
      platform: 'win32',
      env: { PATH: 'C:\\npm', PATHEXT: '.EXE;.CMD' },
      isFile,
    });
    assert.equal(found, 'C:\\npm\\opencode.cmd');
  });

  test('strips quotes from PATH entries', () => {
    const found = which('claude', {
      platform: 'linux',
      env: { PATH: '"/usr/local/bin"' },
      isFile,
    });
    assert.equal(found, '/usr/local/bin/claude');
  });

  test('returns undefined when nothing matches', () => {
    assert.equal(
      which('nope', { platform: 'linux', env: { PATH: '/usr/bin' }, isFile }),
      undefined,
    );
  });
});

describe('quoteForCmd', () => {
  test('leaves a simple token alone', () => {
    assert.equal(quoteForCmd('model'), 'model');
  });

  test('quotes tokens containing spaces', () => {
    assert.equal(quoteForCmd('two words'), '"two words"');
  });

  test('escapes embedded double quotes', () => {
    assert.equal(quoteForCmd('model_provider="anyagent"'), '"model_provider=\\"anyagent\\""');
  });

  test('caret-escapes cmd metacharacters outside quotes', () => {
    // Without escaping, cmd.exe would treat `&` as a command separator and
    // silently truncate the argument.
    assert.equal(quoteForCmd('a&b'), 'a^&b');
    assert.equal(quoteForCmd('a|b'), 'a^|b');
    assert.equal(quoteForCmd('a>b'), 'a^>b');
  });

  test('represents an empty argument', () => {
    assert.equal(quoteForCmd(''), '""');
  });
});

describe('buildCommand', () => {
  test('spawns a POSIX binary directly', () => {
    const command = buildCommand('/usr/local/bin/claude', ['--model', 'x'], 'linux');
    assert.deepEqual(command, {
      file: '/usr/local/bin/claude',
      args: ['--model', 'x'],
      viaShell: false,
    });
  });

  test('spawns a Windows .exe directly', () => {
    const command = buildCommand('C:\\tools\\codex.EXE', ['-c', 'a=1'], 'win32');
    assert.equal(command.viaShell, false);
    assert.equal(command.file, 'C:\\tools\\codex.EXE');
  });

  test('routes .cmd shims through cmd.exe', () => {
    // Node refuses to spawn .cmd directly since CVE-2024-27980.
    const command = buildCommand('C:\\npm\\opencode.cmd', ['run', 'hello world'], 'win32');
    assert.equal(command.viaShell, true);
    assert.deepEqual(command.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(command.args[3], '"C:\\npm\\opencode.cmd run "hello world""');
  });

  test('routes .ps1 through powershell with policy bypass', () => {
    const command = buildCommand('C:\\tools\\agent.ps1', ['x'], 'win32');
    assert.equal(command.file, 'powershell');
    assert.deepEqual(command.args, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\tools\\agent.ps1',
      'x',
    ]);
  });
});

describe('commonBinPaths', () => {
  test('includes the directories installers actually use', () => {
    const posix = commonBinPaths('/home/tester', 'linux');
    assert.ok(posix.some((entry) => entry.endsWith('.local/bin') || entry.endsWith('.local\\bin')));
    assert.ok(posix.includes('/opt/homebrew/bin'));
  });
});
