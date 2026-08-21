/**
 * The picker drives the menu, which is the first thing anyone sees. It is
 * exercised here against a fake terminal - a stream with `isTTY` set and a
 * no-op `setRawMode` - so arrow keys, filtering and separators are covered
 * without a human at a keyboard.
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test, { describe } from 'node:test';

import { isInteractive, select, type SelectItem } from '../src/prompt.js';
import { setColorEnabled } from '../src/ui.js';

setColorEnabled(false);

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  enter: '\r',
  escape: '\u001B',
  backspace: '\u007F',
};

interface FakeTerminal {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  rendered(): string;
}

function terminal(): FakeTerminal {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));

  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: () => input });
  Object.assign(output, { isTTY: true, rows: 24, columns: 80 });

  return {
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    rendered: () => chunks.join(''),
  };
}

/** Send keystrokes once the picker has attached its listener. */
function type(fake: FakeTerminal, keys: string[]): void {
  setImmediate(() => {
    for (const key of keys) fake.input.push(key);
  });
}

const ITEMS: SelectItem[] = [
  { value: 'claude', label: 'claude', detail: 'Claude Code' },
  { value: 'codex', label: 'codex', detail: 'Codex' },
  { value: 'opencode', label: 'opencode', detail: 'OpenCode' },
  { value: 'sep', label: '', separator: true },
  { value: 'action:model', label: 'model', detail: 'Choose the AI model' },
  { value: 'action:quit', label: 'quit', detail: 'Exit' },
];

describe('select', () => {
  test('enter accepts the first entry', async () => {
    const fake = terminal();
    type(fake, [KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'claude');
  });

  test('arrow keys move down the list', async () => {
    const fake = terminal();
    type(fake, [KEY.down, KEY.down, KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'opencode');
  });

  test('separators are displayed but never selected', async () => {
    // Three downs from `claude` lands on `model`, not on the rule between them.
    const fake = terminal();
    type(fake, [KEY.down, KEY.down, KEY.down, KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'action:model');
  });

  test('moving up from the top wraps to the last selectable entry', async () => {
    const fake = terminal();
    type(fake, [KEY.up, KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'action:quit');
  });

  test('`current` decides where the cursor starts', async () => {
    const fake = terminal();
    type(fake, [KEY.enter]);
    const chosen = await select('pick', ITEMS, {
      input: fake.input,
      output: fake.output,
      current: 'codex',
    });
    assert.equal(chosen, 'codex');
  });

  test('typing filters, and matches the detail text too', async () => {
    const fake = terminal();
    type(fake, [...'openc', KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'opencode');
  });

  test('backspace edits the filter', async () => {
    const fake = terminal();
    type(fake, [...'codexx', KEY.backspace, KEY.enter]);
    const chosen = await select('pick', ITEMS, { input: fake.input, output: fake.output });
    assert.equal(chosen, 'codex');
  });

  test('escape cancels rather than choosing something', async () => {
    const fake = terminal();
    type(fake, [KEY.escape]);
    await assert.rejects(
      select('pick', ITEMS, { input: fake.input, output: fake.output }),
      /Cancelled/,
    );
  });

  test('the title and every entry are drawn', async () => {
    const fake = terminal();
    type(fake, [KEY.enter]);
    await select('Which agent?', ITEMS, { input: fake.input, output: fake.output });
    const screen = fake.rendered();
    assert.match(screen, /Which agent\?/);
    for (const item of ITEMS.filter((entry) => !entry.separator)) {
      assert.ok(screen.includes(item.label), `"${item.label}" was never drawn`);
    }
  });

  test('stdin is released when the picker finishes', async () => {
    // The bug this guards: after a menu, readline's decoder keeps stdin
    // flowing, so the agent launched next has to share every keystroke with
    // this process and its arrow keys stop working.
    const fake = terminal();
    type(fake, [KEY.enter]);
    await select('pick', ITEMS, { input: fake.input, output: fake.output });

    assert.equal(fake.input.listenerCount('keypress'), 0, 'a keypress listener survived');
    assert.equal(fake.input.isPaused(), true, 'stdin is still flowing');
  });

  test('stdin is released when the picker is cancelled', async () => {
    const fake = terminal();
    type(fake, [KEY.escape]);
    await select('pick', ITEMS, { input: fake.input, output: fake.output }).catch(() => undefined);
    assert.equal(fake.input.isPaused(), true);
  });

  test('the list is erased on the way out', async () => {
    // Whatever runs next draws its own screen; it should not appear underneath
    // a menu that has already been answered.
    const fake = terminal();
    type(fake, [KEY.enter]);
    await select('pick', ITEMS, { input: fake.input, output: fake.output });
    const ESC_SEQ = String.fromCharCode(27);
    assert.ok(fake.rendered().includes(`${ESC_SEQ}[0J`), 'the picker never cleared what it drew');
  });

  test('an empty list is refused instead of hanging', async () => {
    const fake = terminal();
    await assert.rejects(select('pick', [], { input: fake.input, output: fake.output }));
  });
});

describe('isInteractive', () => {
  test('is false without a terminal on both ends', () => {
    const plain = new PassThrough() as unknown as NodeJS.ReadStream;
    const fake = terminal();
    assert.equal(isInteractive({ input: plain, output: fake.output }), false);
    assert.equal(isInteractive({ input: fake.input, output: fake.output }), true);
  });
});
