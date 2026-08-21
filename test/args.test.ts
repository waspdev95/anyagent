import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { closest, distance, MissingValueError, parseArgs, UnknownFlagError } from '../src/args.js';

const SPECS = {
  model: { type: 'string' as const, short: 'm', description: 'Model' },
  provider: { type: 'string' as const, description: 'Provider' },
  save: { type: 'boolean' as const, short: 's', description: 'Save' },
  json: { type: 'boolean' as const, description: 'JSON' },
};

describe('parseArgs', () => {
  test('reads long flags in both forms', () => {
    const a = parseArgs(['--model', 'gpt-5'], SPECS);
    const b = parseArgs(['--model=gpt-5'], SPECS);
    assert.equal(a.flags.model, 'gpt-5');
    assert.equal(b.flags.model, 'gpt-5');
  });

  test('reads short flags with and without a space', () => {
    assert.equal(parseArgs(['-m', 'gpt-5'], SPECS).flags.model, 'gpt-5');
    assert.equal(parseArgs(['-mgpt-5'], SPECS).flags.model, 'gpt-5');
    assert.equal(parseArgs(['-m=gpt-5'], SPECS).flags.model, 'gpt-5');
  });

  test('clusters boolean shorts', () => {
    const result = parseArgs(['-s'], SPECS);
    assert.equal(result.flags.save, true);
  });

  test('supports --no- prefixes', () => {
    const result = parseArgs(['--no-save'], SPECS);
    assert.equal(result.flags.save, false);
  });

  test('collects positionals in order', () => {
    const result = parseArgs(['claude', 'extra'], SPECS);
    assert.deepEqual(result.positionals, ['claude', 'extra']);
  });

  test('everything after -- is passthrough', () => {
    const result = parseArgs(['claude', '--model', 'x', '--', '--model', 'y'], SPECS);
    assert.equal(result.flags.model, 'x');
    assert.deepEqual(result.passthrough, ['--model', 'y']);
  });

  test('forwards unknown flags when asked, preserving order', () => {
    const result = parseArgs(['claude', '--resume', '-p', 'hello'], SPECS, {
      forwardUnknown: true,
      maxPositionals: 1,
    });
    assert.deepEqual(result.positionals, ['claude']);
    assert.deepEqual(result.passthrough, ['--resume', '-p', 'hello']);
    assert.deepEqual(result.unknown, ['--resume', '-p']);
  });

  test('rejects unknown flags when forwarding is off', () => {
    assert.throws(() => parseArgs(['--nope'], SPECS), UnknownFlagError);
  });

  test('suggests a correction for a near-miss flag', () => {
    try {
      parseArgs(['--modle', 'x'], SPECS);
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof UnknownFlagError);
      assert.equal(error.suggestion, 'model');
    }
  });

  test('rejects a value flag with nothing after it', () => {
    assert.throws(() => parseArgs(['--model'], SPECS), MissingValueError);
    assert.throws(() => parseArgs(['--model', '--'], SPECS), MissingValueError);
  });

  test('a passthrough token that looks like a value is not consumed as one', () => {
    const result = parseArgs(['agent', '--', '-m', 'not-ours'], SPECS, {
      forwardUnknown: true,
      maxPositionals: 1,
    });
    assert.equal(result.flags.model, undefined);
    assert.deepEqual(result.passthrough, ['-m', 'not-ours']);
  });
});

describe('distance and closest', () => {
  test('measures edits', () => {
    assert.equal(distance('model', 'model'), 0);
    assert.equal(distance('modle', 'model'), 2);
    assert.equal(distance('', 'abc'), 3);
  });

  test('only suggests plausible corrections', () => {
    assert.equal(closest('clade', ['claude', 'codex']), 'claude');
    assert.equal(closest('somethingentirelyelse', ['claude', 'codex']), undefined);
  });
});
