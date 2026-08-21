# Contributing

Thanks for helping. The two contributions that matter most are **new agents** and
**corrections to provider endpoints**, because both go stale the moment a vendor
ships a release.

## Getting set up

```bash
git clone https://github.com/waspdev95/anyagent
cd anyagent
npm install
npm run verify      # typecheck + lint + format check + tests + build
```

Useful during development:

```bash
npm test            # compile and run the suite (about two seconds)
npm run dev -- ls   # run the CLI from source
node dist/cli.js ls # run the built CLI
```

Nothing in the test suite touches your real home directory, your real config or
the network. Tests that need a home directory get a temporary one; tests that
need a catalog get a fixture.

## Layout

```
src/
  cli.ts          the bin: nothing but wiring
  app.ts          command dispatch and help
  types.ts        the type model, and the plan/apply contract
  catalog.ts      providers and models: cache, network, bundled snapshot
  data/overlay.ts curated corrections on top of models.dev
  resolve.ts      provider, protocol and model resolution, with the errors
  exec.ts         finding and spawning binaries, cross-platform
  runner.ts       applying a plan: backups, writes, restore, launch
  credentials.ts  key resolution and storage
  agents/         one file per integration
  commands/       one file per command group
test/             mirrors src/, plus an end-to-end cli.test.ts
```

## Adding an agent

An agent is a description plus one pure function.

```ts
import type { Agent, LaunchPlan, PlanContext } from '../types.js';

export const myagent: Agent = {
  id: 'myagent',
  name: 'My Agent',
  description: 'One line, lower case, no trailing period',
  homepage: 'https://example.com/docs',

  // Protocols this agent can consume, best first. This is the compatibility
  // contract: anyagent will refuse providers that speak none of them.
  wires: ['openai-chat'],

  bin: ['myagent'],
  install: {
    command: ['npm', 'install', '-g', 'myagent'],
    url: 'https://example.com/install',
  },

  plan(ctx: PlanContext): LaunchPlan {
    const { target } = ctx;
    return {
      command: { file: 'myagent', args: ['--model', target.model.id, ...ctx.passthrough] },
      env: {
        MYAGENT_BASE_URL: target.baseUrl,
        MYAGENT_API_KEY: target.apiKey,
      },
      files: [],
      notes: [],
    };
  },
};
```

Register it in `src/agents/index.ts`, then add tests to `test/agents.test.ts`.

### Rules `plan()` must follow

1. **No I/O.** No `fs`, no `fetch`, no `spawn`, no `Date.now()`. Everything it
   needs arrives in `PlanContext`, including `now` and `agentVersion`. This is
   what makes the integrations testable and the behaviour reproducible.
2. **Prefer not writing files.** In order of preference: environment variables →
   an inline config passed through the environment → a config layer the agent
   accepts as a flag (`--patch`, `--profile`, `-c`) → an isolated profile
   directory anyagent owns → merging the user's own config.
3. **If you must merge**, declare the files in `reads()`, mutate only what lives
   under the `anyagent` key, mark the file `backup: true`, and list it in
   `ownedFiles()`. Preserve every unknown key — someone spent time on it.
4. **Never write a credential into a file** if the agent can read it from an
   environment variable by name. `dsh` is the model to copy.
5. **Forward `ctx.passthrough` verbatim**, after your own arguments.

### Tests a new agent needs

At minimum:

- the endpoint, key and model land where the agent actually reads them
- `ctx.passthrough` survives, in order
- if it merges: an unrelated key in the existing config is preserved
- if it writes a credential: assert it is _not_ in the file contents

`test/agents.test.ts` has a suite that runs against every registered agent —
uniqueness, declared metadata, and that `plan()` never mutates its input — so some
coverage arrives for free.

## Adding or fixing a provider

Most providers need no code: they come from [models.dev](https://models.dev) and
are refreshed by `anyagent update`. Add an entry to `src/data/overlay.ts` only
when the catalog cannot express something:

- the base URL is missing because the vendor SDK hard-codes it
- the provider serves an **Anthropic-compatible** endpoint (the catalog has no
  field for this, and it is the only way to run Claude Code)
- the provider serves an **OpenAI Responses** endpoint (required by Codex)
- extra headers, a key prefix, or a console URL for the setup prompt

### Verifying an endpoint claim

Endpoint claims are load-bearing: a wrong one sends people into a failing session.
Every entry records how it was established.

- **`probe`** — the route answers with an auth error while a bogus sibling route
  on the same host returns 404:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.example.com/anthropic/v1/messages \
    -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
    -d '{"model":"x","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
  # 401 or 403 = the route exists

  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.example.com/anthropic/v1/zzz -d '{}'
  # 404 = the host routes before it authenticates, so the result above is meaningful
  ```

- **`docs`** — the vendor documents it, but the host authenticates before routing
  so a probe cannot tell the difference. Link the documentation in your PR.

A claim with neither is not accepted. `test/catalog.test.ts` enforces that every
declared Anthropic endpoint carries a source.

## Refreshing the bundled catalog

```bash
npm run snapshot    # rebuild src/data/catalog.snapshot.json.gz from models.dev
```

The snapshot is what makes a fresh install work with no network. Regenerate it
when it drifts far enough to matter; it is roughly 150 KB.

## Style

- TypeScript, strict, ESM. No runtime dependencies — please keep it that way.
- Comments explain _why_, not what. If a line exists because a vendor rejects
  something or a platform behaves oddly, say so — that is the comment that saves
  the next person an afternoon.
- `npm run format` before pushing.

## Pull requests

- One concern per PR.
- Say how you verified it. "Ran `anyagent codex -m x -- exec 'say hi'` against
  OpenRouter" is worth more than any amount of description.
- Note any vendor version you tested against; integrations are version-sensitive
  and `PlanContext.agentVersion` exists precisely for that.

## Code of conduct

Be decent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
